import Foundation
import Testing
@testable import CalendarBridgeCore

@Test func acceptsOnlyTheReadProtocolMethods() throws {
    for method in ["authorization_status", "request_access", "list_calendars", "list_events"] {
        let data = Data("{\"version\":1,\"id\":\"request-1\",\"method\":\"\(method)\"}".utf8)
        let request = try CalendarBridgeProtocol.decodeRequest(data)
        #expect(request.method.rawValue == method)
    }

    let mutation = Data(#"{"version":1,"id":"request-2","method":"save_event"}"#.utf8)
    #expect(throws: BridgeProtocolError.unknownMethod) {
        try CalendarBridgeProtocol.decodeRequest(mutation)
    }
}

@Test func rejectsOversizedAndMalformedRequests() {
    #expect(throws: BridgeProtocolError.requestTooLarge) {
        try CalendarBridgeProtocol.decodeRequest(Data(repeating: 0x20, count: 1_048_577))
    }
    #expect(throws: BridgeProtocolError.invalidRequest) {
        try CalendarBridgeProtocol.decodeRequest(Data("not json".utf8))
    }
}

@Test func parsesJavaScriptFractionalSecondTimestamps() {
    #expect(CalendarBridgeProtocol.parseISO8601("2026-08-16T16:00:00.000Z") != nil)
}

@Test func requiresOneCalendarAndABoundedWindow() throws {
    let start = Date(timeIntervalSince1970: 1_780_000_000)
    let end = start.addingTimeInterval(60 * 60 * 24 * 44)
    let params = ListEventsParams(
        calendarIdentifier: "calendar-a",
        start: start,
        end: end
    )
    #expect(try CalendarBridgeProtocol.validate(params) == params)

    #expect(throws: BridgeProtocolError.invalidCalendar) {
        try CalendarBridgeProtocol.validate(
            ListEventsParams(calendarIdentifier: "  ", start: start, end: end)
        )
    }
    #expect(throws: BridgeProtocolError.invalidWindow) {
        try CalendarBridgeProtocol.validate(
            ListEventsParams(calendarIdentifier: "calendar-a", start: end, end: start)
        )
    }
    #expect(throws: BridgeProtocolError.windowTooLarge) {
        try CalendarBridgeProtocol.validate(
            ListEventsParams(
                calendarIdentifier: "calendar-a",
                start: start,
                end: start.addingTimeInterval(60 * 60 * 24 * 61)
            )
        )
    }
}

@Test func normalizesOnlyMeetingContextFields() {
    let start = Date(timeIntervalSince1970: 1_780_000_000)
    let value = EventValue(
        identifier: "event-a",
        title: "Product review",
        start: start,
        end: start.addingTimeInterval(3_600),
        isAllDay: false,
        isCancelled: false,
        availability: "busy",
        organizer: CalendarPerson(name: "Alex", email: "alex@example.com"),
        attendees: [CalendarPerson(name: "Sam", email: "sam@example.com")],
        lastModified: start.addingTimeInterval(-60)
    )

    let normalized = CalendarBridgeProtocol.normalize(
        calendarIdentifier: "calendar-a",
        event: value
    )

    #expect(normalized.occurrenceKey == "calendar-a|event-a|2026-05-28T20:26:40.000Z")
    #expect(normalized.title == "Product review")
    #expect(normalized.organizer?.email == "alex@example.com")
    #expect(normalized.attendees.map(\.name) == ["Sam"])
    #expect(normalized.start == start)
}

@Test func recurringOccurrencesHaveDistinctStableKeys() {
    let first = Date(timeIntervalSince1970: 1_780_000_000)
    let second = first.addingTimeInterval(604_800)
    let base = EventValue(
        identifier: "recurring-a",
        title: "Weekly review",
        start: first,
        end: first.addingTimeInterval(1_800),
        isAllDay: false,
        isCancelled: false,
        availability: nil,
        organizer: nil,
        attendees: [],
        lastModified: nil
    )
    let occurrenceOne = CalendarBridgeProtocol.normalize(
        calendarIdentifier: "calendar-a",
        event: base
    )
    let occurrenceTwo = CalendarBridgeProtocol.normalize(
        calendarIdentifier: "calendar-a",
        event: base.withDates(start: second, end: second.addingTimeInterval(1_800))
    )

    #expect(occurrenceOne.occurrenceKey == CalendarBridgeProtocol.normalize(calendarIdentifier: "calendar-a", event: base).occurrenceKey)
    #expect(occurrenceOne.occurrenceKey != occurrenceTwo.occurrenceKey)
}
