import CalendarBridgeCore
import EventKit
import Foundation

private let eventStore = EKEventStore()
private let outputLock = NSLock()

private struct CalendarDescriptor: Encodable {
    let identifier: String
    let title: String
    let sourceTitle: String
    let sourceType: String
    let colorHex: String?
}

private struct StatusPayload: Encodable {
    let status: String
}

private struct CalendarsPayload: Encodable {
    let calendars: [CalendarDescriptor]
}

private struct EventsPayload: Encodable {
    let events: [NormalizedEvent]
}

private struct ErrorPayload: Encodable {
    let code: String
    let message: String
}

private func encodeObject<T: Encodable>(_ value: T) throws -> Any {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    let data = try encoder.encode(value)
    return try JSONSerialization.jsonObject(with: data)
}

private func emit(id: String?, result: (any Encodable)? = nil, error: ErrorPayload? = nil) {
    var envelope: [String: Any] = ["version": 1]
    if let id { envelope["id"] = id }
    do {
        if let result { envelope["result"] = try encodeObject(result) }
        if let error { envelope["error"] = try encodeObject(error) }
        let data = try JSONSerialization.data(withJSONObject: envelope)
        outputLock.lock()
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
        outputLock.unlock()
    } catch {
        // stdout is protocol-only; an encoding failure cannot safely be recovered.
    }
}

private func authorizationStatus() -> String {
    switch EKEventStore.authorizationStatus(for: .event) {
    case .notDetermined: return "not_determined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .authorized, .fullAccess: return "full_access"
    case .writeOnly: return "denied"
    @unknown default: return "restricted"
    }
}

@MainActor
private func requestAccess() async -> Bool {
    if #available(macOS 14.0, *) {
        return await withCheckedContinuation { continuation in
            eventStore.requestFullAccessToEvents { value, _ in
                continuation.resume(returning: value)
            }
        }
    }
    return await withCheckedContinuation { continuation in
        eventStore.requestAccess(to: .event) { value, _ in
            continuation.resume(returning: value)
        }
    }
}

private func sourceType(_ type: EKSourceType) -> String {
    switch type {
    case .local: return "local"
    case .exchange: return "exchange"
    case .calDAV: return "caldav"
    case .mobileMe: return "icloud"
    case .subscribed: return "subscribed"
    case .birthdays: return "birthdays"
    @unknown default: return "other"
    }
}

private func colorHex(_ color: CGColor) -> String? {
    guard let components = color.components, components.count >= 3 else { return nil }
    return String(
        format: "#%02X%02X%02X",
        Int(components[0] * 255),
        Int(components[1] * 255),
        Int(components[2] * 255)
    )
}

@MainActor
private func calendars() -> [CalendarDescriptor] {
    eventStore.calendars(for: .event)
        .filter { $0.type != .birthday }
        .map {
            CalendarDescriptor(
                identifier: $0.calendarIdentifier,
                title: $0.title,
                sourceTitle: $0.source.title,
                sourceType: sourceType($0.source.sourceType),
                colorHex: colorHex($0.cgColor)
            )
        }
        .sorted {
            if $0.sourceTitle == $1.sourceTitle { return $0.title < $1.title }
            return $0.sourceTitle < $1.sourceTitle
        }
}

private func availability(_ value: EKEventAvailability) -> String? {
    switch value {
    case .busy: return "busy"
    case .free: return "free"
    case .tentative: return "tentative"
    case .unavailable: return "unavailable"
    case .notSupported: return nil
    @unknown default: return nil
    }
}

private func person(_ participant: EKParticipant?) -> CalendarPerson? {
    guard let participant else { return nil }
    let email = participant.url.scheme == "mailto"
        ? String(participant.url.absoluteString.dropFirst("mailto:".count))
        : nil
    return CalendarPerson(name: participant.name, email: email)
}

@MainActor
private func events(params: [String: String]) throws -> [NormalizedEvent] {
    guard
        let calendarIdentifier = params["calendarIdentifier"],
        let startValue = params["start"],
        let endValue = params["end"],
        let start = ISO8601DateFormatter().date(from: startValue),
        let end = ISO8601DateFormatter().date(from: endValue)
    else { throw BridgeProtocolError.invalidRequest }
    _ = try CalendarBridgeProtocol.validate(
        ListEventsParams(calendarIdentifier: calendarIdentifier, start: start, end: end)
    )
    guard let calendar = eventStore.calendar(withIdentifier: calendarIdentifier) else {
        throw BridgeProtocolError.invalidCalendar
    }
    let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: [calendar])
    return eventStore.events(matching: predicate).map { event in
        CalendarBridgeProtocol.normalize(
            calendarIdentifier: calendarIdentifier,
            event: EventValue(
                identifier: event.eventIdentifier ?? event.calendarItemIdentifier,
                title: event.title ?? "Untitled event",
                start: event.startDate,
                end: event.endDate,
                isAllDay: event.isAllDay,
                isCancelled: event.status == .canceled,
                availability: availability(event.availability),
                organizer: person(event.organizer),
                attendees: (event.attendees ?? []).compactMap(person),
                lastModified: event.lastModifiedDate
            )
        )
    }
}

@MainActor
private func runBridge() async {
    let observer = NotificationCenter.default.addObserver(
        forName: .EKEventStoreChanged,
        object: eventStore,
        queue: nil
    ) { _ in
        outputLock.lock()
        FileHandle.standardOutput.write(Data("{\"version\":1,\"event\":\"event_store_changed\"}\n".utf8))
        outputLock.unlock()
    }

    while let line = readLine(strippingNewline: true) {
        guard let data = line.data(using: .utf8) else { continue }
        var requestID: String?
        do {
            let request = try CalendarBridgeProtocol.decodeRequest(data)
            requestID = request.id
            switch request.method {
            case .authorizationStatus:
                emit(id: request.id, result: StatusPayload(status: authorizationStatus()))
            case .requestAccess:
                _ = await requestAccess()
                emit(id: request.id, result: StatusPayload(status: authorizationStatus()))
            case .listCalendars:
                emit(id: request.id, result: CalendarsPayload(calendars: calendars()))
            case .listEvents:
                emit(id: request.id, result: EventsPayload(events: try events(params: request.params)))
            }
        } catch let error as BridgeProtocolError {
            emit(id: requestID, error: ErrorPayload(code: error.rawValue, message: "Calendar request was rejected."))
        } catch {
            emit(id: requestID, error: ErrorPayload(code: "read_failed", message: "Calendar data could not be read."))
        }
    }
    NotificationCenter.default.removeObserver(observer)
}

Task { @MainActor in
    await runBridge()
    exit(EXIT_SUCCESS)
}
dispatchMain()
