#include <node_api.h>
#include <sys/sysctl.h>
#include <time.h>
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

struct ClickState {
  std::mutex mutex;
  napi_threadsafe_function listener = nullptr;
  bool closing = false;
  std::vector<std::string> pending;
};

static void DeliverClick(napi_env env, napi_value callback, void*, void* raw) {
  std::unique_ptr<std::string> entity(static_cast<std::string*>(raw));
  if (!env || !callback) return;
  napi_value argument, receiver, result;
  napi_create_string_utf8(env, entity->c_str(), entity->size(), &argument);
  napi_get_undefined(env, &receiver);
  napi_call_function(env, receiver, callback, 1, &argument, &result);
}

@interface PlutoNotificationDelegate : NSObject <UNUserNotificationCenterDelegate> {
@public
  std::shared_ptr<ClickState> state;
}
@end
@implementation PlutoNotificationDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter*)center
       willPresentNotification:(UNNotification*)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completion {
  completion(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList | UNNotificationPresentationOptionSound);
}
- (void)userNotificationCenter:(UNUserNotificationCenter*)center
 didReceiveNotificationResponse:(UNNotificationResponse*)response
         withCompletionHandler:(void (^)(void))completion {
  // Only route our own requests; dismissal is never a click.
  if ([response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier] &&
      [response.notification.request.identifier hasPrefix:@"pluto-commitment:"]) {
    id entity = response.notification.request.content.userInfo[@"entityId"];
    if ([entity isKindOfClass:[NSString class]] && [entity length] > 0) {
      std::lock_guard<std::mutex> lock(state->mutex);
      if (!state->closing) {
        auto value = std::make_unique<std::string>([(NSString*)entity UTF8String]);
        if (state->listener) {
          if (napi_call_threadsafe_function(state->listener, value.get(), napi_tsfn_nonblocking) == napi_ok) value.release();
        } else if (state->pending.size() < 32) state->pending.push_back(*value);
      }
    }
  }
  completion();
}
@end

struct Bridge {
  std::shared_ptr<ClickState> state;
  __strong PlutoNotificationDelegate* delegate;
};

static void ResolveString(napi_env env, napi_value, void* context, void* raw) {
  std::unique_ptr<std::string> value(static_cast<std::string*>(raw));
  if (!env) return;
  napi_value result;
  napi_create_string_utf8(env, value->c_str(), value->size(), &result);
  napi_resolve_deferred(env, static_cast<napi_deferred>(context), result);
}
static napi_threadsafe_function Promise(napi_env env, napi_value* promise) {
  napi_deferred deferred;
  napi_value name;
  napi_create_promise(env, &deferred, promise);
  napi_create_string_utf8(env, "PlutoNotificationOperation", NAPI_AUTO_LENGTH, &name);
  napi_threadsafe_function completion;
  napi_create_threadsafe_function(env, nullptr, nullptr, name, 0, 1, nullptr, nullptr, deferred, ResolveString, &completion);
  // Native callbacks must not keep Electron alive after the bounded JS operation times out.
  napi_unref_threadsafe_function(env, completion);
  return completion;
}
static void Finish(napi_threadsafe_function completion, const char* value) {
  auto result = std::make_unique<std::string>(value);
  if (napi_call_threadsafe_function(completion, result.get(), napi_tsfn_nonblocking) == napi_ok) result.release();
  napi_release_threadsafe_function(completion, napi_tsfn_release);
}
static napi_value Permission(napi_env env, napi_callback_info info) {
  void* request = nullptr;
  napi_get_cb_info(env, info, nullptr, nullptr, nullptr, &request);
  napi_value promise;
  auto completion = Promise(env, &promise);
  UNUserNotificationCenter* center = [UNUserNotificationCenter currentNotificationCenter];
  if (request) {
    [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound)
      completionHandler:^(BOOL granted, NSError* error) { Finish(completion, error ? "error" : granted ? "authorized" : "denied"); }];
  } else {
    [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings* settings) {
      switch (settings.authorizationStatus) {
        case UNAuthorizationStatusNotDetermined: Finish(completion, "not-determined"); break;
        case UNAuthorizationStatusDenied: Finish(completion, "denied"); break;
        case UNAuthorizationStatusAuthorized:
        case UNAuthorizationStatusProvisional: Finish(completion, "authorized"); break;
        default: Finish(completion, "unsupported");
      }
    }];
  }
  return promise;
}
static bool StringArgument(napi_env env, napi_value value, std::string* output) {
  size_t size = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &size) != napi_ok || size > 16384) return false;
  output->resize(size + 1);
  napi_get_value_string_utf8(env, value, output->data(), size + 1, &size);
  output->resize(size);
  return true;
}
static NSString* NativeString(const std::string& value) { return [[NSString alloc] initWithBytes:value.data() length:value.size() encoding:NSUTF8StringEncoding]; }
static napi_value Submit(napi_env env, napi_callback_info info) {
  size_t count = 4;
  napi_value args[4];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  std::string values[4];
  if (count != 4) { napi_throw_type_error(env, nullptr, "submit requires id, title, body and entityId"); return nullptr; }
  for (size_t i = 0; i < 4; ++i) if (!StringArgument(env, args[i], &values[i])) { napi_throw_type_error(env, nullptr, "Notification arguments must be strings"); return nullptr; }
  napi_value promise;
  auto completion = Promise(env, &promise);
  UNMutableNotificationContent* content = [UNMutableNotificationContent new];
  content.title = NativeString(values[1]);
  content.body = NativeString(values[2]);
  content.sound = [UNNotificationSound defaultSound];
  content.userInfo = @{ @"entityId": NativeString(values[3]) };
  NSString* identifier = [@"pluto-commitment:" stringByAppendingString:NativeString(values[0])];
  UNNotificationRequest* request = [UNNotificationRequest requestWithIdentifier:identifier content:content trigger:nil];
  [[UNUserNotificationCenter currentNotificationCenter] addNotificationRequest:request withCompletionHandler:^(NSError* error) { Finish(completion, error ? "failed" : "submitted"); }];
  return promise;
}
static napi_value Cancel(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value arg;
  napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr);
  std::string id;
  if (count != 1 || !StringArgument(env, arg, &id)) { napi_throw_type_error(env, nullptr, "cancel requires an id"); return nullptr; }
  NSArray* ids = @[ [@"pluto-commitment:" stringByAppendingString:NativeString(id)] ];
  UNUserNotificationCenter* center = [UNUserNotificationCenter currentNotificationCenter];
  [center removePendingNotificationRequestsWithIdentifiers:ids];
  [center removeDeliveredNotificationsWithIdentifiers:ids];
  napi_value result; napi_get_undefined(env, &result); return result;
}
static napi_value OnClick(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value callback, name;
  void* raw;
  napi_get_cb_info(env, info, &count, &callback, nullptr, &raw);
  napi_valuetype type;
  if (count != 1 || napi_typeof(env, callback, &type) != napi_ok || type != napi_function) { napi_throw_type_error(env, nullptr, "onClick requires a callback"); return nullptr; }
  auto* bridge = static_cast<Bridge*>(raw);
  std::lock_guard<std::mutex> lock(bridge->state->mutex);
  if (bridge->state->listener) napi_release_threadsafe_function(bridge->state->listener, napi_tsfn_abort);
  napi_create_string_utf8(env, "PlutoNotificationClick", NAPI_AUTO_LENGTH, &name);
  napi_create_threadsafe_function(env, callback, nullptr, name, 0, 1, nullptr, nullptr, nullptr, DeliverClick, &bridge->state->listener);
  napi_unref_threadsafe_function(env, bridge->state->listener);
  for (const auto& entity : bridge->state->pending) {
    auto value = std::make_unique<std::string>(entity);
    if (napi_call_threadsafe_function(bridge->state->listener, value.get(), napi_tsfn_nonblocking) == napi_ok) value.release();
  }
  bridge->state->pending.clear();
  napi_value result; napi_get_undefined(env, &result); return result;
}
static void Cleanup(void* raw) {
  auto* bridge = static_cast<Bridge*>(raw);
  {
    std::lock_guard<std::mutex> lock(bridge->state->mutex);
    bridge->state->closing = true;
    if (bridge->state->listener) napi_release_threadsafe_function(bridge->state->listener, napi_tsfn_abort);
    bridge->state->listener = nullptr;
  }
  UNUserNotificationCenter* center = [UNUserNotificationCenter currentNotificationCenter];
  if (center.delegate == bridge->delegate) center.delegate = nil;
  delete bridge;
}
// Read the same kernel level used by memory_pressure, on the guard's own thread.
static napi_value MemoryPressureSample(napi_env env, napi_callback_info) {
  struct timespec measuredAt;
  int32_t level = 0;
  size_t size = sizeof(level);
  // Timestamp before the kernel call so delayed reads still fail the JS age check.
  if (clock_gettime(CLOCK_REALTIME, &measuredAt) != 0 ||
      sysctlbyname("kern.memorystatus_level", &level, &size, nullptr, 0) != 0 ||
      size != sizeof(level) || level < 0 || level > 100) {
    napi_throw_error(env, nullptr, "Kernel memory level unavailable.");
    return nullptr;
  }
  const int64_t wallTimeMs = static_cast<int64_t>(measuredAt.tv_sec) * 1000 + measuredAt.tv_nsec / 1000000;
  napi_value sample, timestamp, percent;
  if (napi_create_object(env, &sample) != napi_ok ||
      napi_create_int64(env, wallTimeMs, &timestamp) != napi_ok ||
      napi_create_int32(env, level, &percent) != napi_ok ||
      napi_set_named_property(env, sample, "wallTimeMs", timestamp) != napi_ok ||
      napi_set_named_property(env, sample, "memoryPressureFreePercent", percent) != napi_ok) {
    napi_throw_error(env, nullptr, "Kernel memory sample unavailable.");
    return nullptr;
  }
  return sample;
}

static napi_value Init(napi_env env, napi_value exports) {
  auto* bridge = new Bridge;
  bridge->state = std::make_shared<ClickState>();
  bridge->delegate = [PlutoNotificationDelegate new];
  bridge->delegate->state = bridge->state;
  [UNUserNotificationCenter currentNotificationCenter].delegate = bridge->delegate;
  napi_add_env_cleanup_hook(env, Cleanup, bridge);
  napi_property_descriptor methods[] = {
    {"memoryPressureSample", nullptr, MemoryPressureSample, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"status", nullptr, Permission, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"request", nullptr, Permission, nullptr, nullptr, nullptr, napi_default, (void*)1},
    {"submit", nullptr, Submit, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"cancel", nullptr, Cancel, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"onClick", nullptr, OnClick, nullptr, nullptr, nullptr, napi_default, bridge},
  };
  napi_define_properties(env, exports, 6, methods);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
