import Foundation

public enum BridgeMethod: String, Codable, CaseIterable, Sendable {
    case authorizationStatus = "authorization_status"
    case requestAccess = "request_access"
    case listCalendars = "list_calendars"
    case listEvents = "list_events"
}

public struct BridgeRequest: Equatable, Sendable {
    public let version: Int
    public let id: String
    public let method: BridgeMethod
    public let params: [String: String]
}

public enum BridgeProtocolError: String, Error, Equatable, Sendable {
    case requestTooLarge
    case invalidRequest
    case unknownMethod
    case invalidCalendar
    case invalidWindow
    case windowTooLarge
}

public struct ListEventsParams: Equatable, Sendable {
    public let calendarIdentifier: String
    public let start: Date
    public let end: Date

    public init(calendarIdentifier: String, start: Date, end: Date) {
        self.calendarIdentifier = calendarIdentifier
        self.start = start
        self.end = end
    }
}

public struct CalendarPerson: Codable, Equatable, Sendable {
    public let name: String?
    public let email: String?

    public init(name: String?, email: String?) {
        self.name = name
        self.email = email
    }
}

public struct CalendarRecurrenceRule: Codable, Equatable, Sendable {
    public let frequency: String
    public let interval: Int
    public let daysOfWeek: [Int]
    public let endDate: Date?
    public let occurrenceCount: Int?

    public init(frequency: String, interval: Int, daysOfWeek: [Int], endDate: Date?, occurrenceCount: Int?) {
        self.frequency = frequency
        self.interval = interval
        self.daysOfWeek = daysOfWeek
        self.endDate = endDate
        self.occurrenceCount = occurrenceCount
    }
}

public struct EventValue: Equatable, Sendable {
    public let identifier: String
    public let title: String
    public let start: Date
    public let end: Date
    public let isAllDay: Bool
    public let isCancelled: Bool
    public let availability: String?
    public let organizer: CalendarPerson?
    public let attendees: [CalendarPerson]
    public let lastModified: Date?
    public let calendarItemIdentifier: String?
    public let calendarItemExternalIdentifier: String?
    public let notes: String?
    public let hasRecurrenceRules: Bool
    public let recurrenceRules: [CalendarRecurrenceRule]

    public init(
        identifier: String,
        title: String,
        start: Date,
        end: Date,
        isAllDay: Bool,
        isCancelled: Bool,
        availability: String?,
        organizer: CalendarPerson?,
        attendees: [CalendarPerson],
        lastModified: Date?,
        calendarItemIdentifier: String? = nil,
        calendarItemExternalIdentifier: String? = nil,
        notes: String? = nil,
        hasRecurrenceRules: Bool = false,
        recurrenceRules: [CalendarRecurrenceRule] = []
    ) {
        self.identifier = identifier
        self.title = title
        self.start = start
        self.end = end
        self.isAllDay = isAllDay
        self.isCancelled = isCancelled
        self.availability = availability
        self.organizer = organizer
        self.attendees = attendees
        self.lastModified = lastModified
        self.calendarItemIdentifier = calendarItemIdentifier
        self.calendarItemExternalIdentifier = calendarItemExternalIdentifier
        self.notes = notes
        self.hasRecurrenceRules = hasRecurrenceRules
        self.recurrenceRules = recurrenceRules
    }

    public func withDates(start: Date, end: Date) -> EventValue {
        EventValue(
            identifier: identifier,
            title: title,
            start: start,
            end: end,
            isAllDay: isAllDay,
            isCancelled: isCancelled,
            availability: availability,
            organizer: organizer,
            attendees: attendees,
            lastModified: lastModified,
            calendarItemIdentifier: calendarItemIdentifier,
            calendarItemExternalIdentifier: calendarItemExternalIdentifier,
            notes: notes,
            hasRecurrenceRules: hasRecurrenceRules,
            recurrenceRules: recurrenceRules
        )
    }
}

public struct NormalizedEvent: Codable, Equatable, Sendable {
    public let occurrenceKey: String
    public let eventIdentifier: String
    public let calendarIdentifier: String
    public let title: String
    public let start: Date
    public let end: Date
    public let isAllDay: Bool
    public let isCancelled: Bool
    public let availability: String?
    public let organizer: CalendarPerson?
    public let attendees: [CalendarPerson]
    public let lastModified: Date?
    public let calendarItemIdentifier: String?
    public let calendarItemExternalIdentifier: String?
    public let notes: String?
    public let hasRecurrenceRules: Bool
    public let recurrenceRules: [CalendarRecurrenceRule]
}

public enum CalendarBridgeProtocol {
    public static let maximumRequestBytes = 1_048_576
    public static let maximumWindow: TimeInterval = 60 * 60 * 24 * 60

    public static func parseISO8601(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)
    }

    private struct RawRequest: Decodable {
        let version: Int
        let id: String
        let method: String
        let params: [String: String]?
    }

    public static func decodeRequest(_ data: Data) throws -> BridgeRequest {
        guard data.count <= maximumRequestBytes else {
            throw BridgeProtocolError.requestTooLarge
        }
        let raw: RawRequest
        do {
            raw = try JSONDecoder().decode(RawRequest.self, from: data)
        } catch {
            throw BridgeProtocolError.invalidRequest
        }
        guard raw.version == 1, !raw.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw BridgeProtocolError.invalidRequest
        }
        guard let method = BridgeMethod(rawValue: raw.method) else {
            throw BridgeProtocolError.unknownMethod
        }
        return BridgeRequest(
            version: raw.version,
            id: raw.id,
            method: method,
            params: raw.params ?? [:]
        )
    }

    public static func validate(_ params: ListEventsParams) throws -> ListEventsParams {
        guard !params.calendarIdentifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw BridgeProtocolError.invalidCalendar
        }
        guard params.start < params.end else {
            throw BridgeProtocolError.invalidWindow
        }
        guard params.end.timeIntervalSince(params.start) <= maximumWindow else {
            throw BridgeProtocolError.windowTooLarge
        }
        return params
    }

    public static func normalize(
        calendarIdentifier: String,
        event: EventValue
    ) -> NormalizedEvent {
        NormalizedEvent(
            occurrenceKey: [
                calendarIdentifier,
                event.identifier,
                timestamp(event.start),
            ].joined(separator: "|"),
            eventIdentifier: event.identifier,
            calendarIdentifier: calendarIdentifier,
            title: event.title.trimmingCharacters(in: .whitespacesAndNewlines),
            start: event.start,
            end: event.end,
            isAllDay: event.isAllDay,
            isCancelled: event.isCancelled,
            availability: event.availability,
            organizer: event.organizer,
            attendees: event.attendees,
            lastModified: event.lastModified,
            calendarItemIdentifier: event.calendarItemIdentifier,
            calendarItemExternalIdentifier: event.calendarItemExternalIdentifier,
            notes: event.notes,
            hasRecurrenceRules: event.hasRecurrenceRules || !event.recurrenceRules.isEmpty,
            recurrenceRules: event.recurrenceRules
        )
    }

    private static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }
}
