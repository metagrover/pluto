#include <CommonCrypto/CommonDigest.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "api/audio/audio_processing.h"

namespace {
constexpr int kSampleRate = 16000;
constexpr int kFrameSamples = 160;
constexpr int kSampleCount = kSampleRate * 5;

std::string digest(const std::vector<int16_t>& values) {
  unsigned char bytes[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(values.data(), static_cast<CC_LONG>(values.size() * sizeof(int16_t)), bytes);
  std::ostringstream output;
  for (auto byte : bytes) output << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(byte);
  return output.str();
}
double energy(const std::vector<int16_t>& values) {
  double total = 0;
  for (auto value : values) total += static_cast<double>(value) * value;
  return total;
}
double correlation(const std::vector<int16_t>& first, const std::vector<int16_t>& second) {
  double dot = 0, firstEnergy = 0, secondEnergy = 0;
  for (size_t index = 0; index < first.size(); ++index) {
    dot += static_cast<double>(first[index]) * second[index];
    firstEnergy += static_cast<double>(first[index]) * first[index];
    secondEnergy += static_cast<double>(second[index]) * second[index];
  }
  return dot / std::sqrt(firstEnergy * secondEnergy);
}
std::vector<int16_t> run(const std::vector<int16_t>& system, const std::vector<int16_t>& mic, int delayMs) {
  auto processor = webrtc::AudioProcessingBuilder().Create();
  webrtc::AudioProcessing::Config config;
  config.echo_canceller.enabled = true;
  processor->ApplyConfig(config);
  const webrtc::StreamConfig stream(kSampleRate, 1);
  std::vector<int16_t> render = system;
  std::vector<int16_t> residual(mic.size());
  for (int offset = 0; offset < kSampleCount; offset += kFrameSamples) {
    if (processor->ProcessReverseStream(render.data() + offset, stream, stream, render.data() + offset) != 0 ||
        processor->set_stream_delay_ms(delayMs) != 0 ||
        processor->ProcessStream(mic.data() + offset, stream, stream, residual.data() + offset) != 0) {
      throw std::runtime_error("upstream_audio_processing_failed");
    }
  }
  return residual;
}
void emit(std::string_view kind, int delayMs, int driftPpm) {
  std::vector<double> source(kSampleCount);
  uint32_t state = 400;
  for (int index = 0; index < kSampleCount; ++index) {
    state = state * 1664525u + 1013904223u;
    const double noise = (static_cast<double>(state) / 4294967296.0) * 2 - 1;
    source[index] = (std::sin(2 * M_PI * 440 * index / kSampleRate) * .8 + noise * .2) * .8;
  }
  std::vector<int16_t> system(kSampleCount), mic(kSampleCount);
  for (int index = 0; index < kSampleCount; ++index) {
    const double position = std::clamp(index * (1.0 + driftPpm / 1000000.0) - delayMs * 16.0, 0.0, static_cast<double>(kSampleCount - 1));
    const auto lower = static_cast<int>(position);
    const auto upper = std::min(kSampleCount - 1, lower + 1);
    const double echo = (source[lower] * (1 - position + lower) + source[upper] * (position - lower)) * .8;
    system[index] = static_cast<int16_t>(std::clamp(source[index] * 32767, -32767.0, 32767.0));
    mic[index] = static_cast<int16_t>(std::clamp(echo * 32767, -32767.0, 32767.0));
  }
  const auto first = run(system, mic, delayMs);
  const auto second = run(system, mic, delayMs);
  std::cout << "{\"kind\":\"" << kind << "\",\"delayMs\":" << delayMs
            << ",\"driftPpm\":" << driftPpm
            << ",\"inputEnergy\":" << energy(mic)
            << ",\"outputEnergy\":" << energy(first)
            << ",\"preCorrelation\":" << correlation(system, mic)
            << ",\"postCorrelation\":" << correlation(system, first)
            << ",\"firstResidualDigest\":\"" << digest(first)
            << "\",\"secondResidualDigest\":\"" << digest(second) << "\"}" << std::endl;
}
}
int main() {
  for (int delay : {0, 40, 100, 160, 200}) emit("delay", delay, 0);
  for (int drift : {-100, 0, 100}) emit("drift", 40, drift);
}
