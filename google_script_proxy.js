/**
 * Google Apps Script Proxy for Calendar
 * 
 * 1. Go to script.google.com
 * 2. New Project
 * 3. Paste this code.
 * 4. Deploy > New Deployment > Web App
 * 5. Access: Anyone
 * 
 * This will handle CORS and Calendar interaction.
 */

function doGet(e) {
    const calendarName = e.parameter.calendarName || 'Primary';
    const cal = CalendarApp.getDefaultCalendar();

    // Example: Get events for the next 7 days
    const now = new Date();
    const nextWeek = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
    const events = cal.getEvents(now, nextWeek);

    const eventList = events.map(ev => ({
        title: ev.getTitle(),
        start: ev.getStartTime(),
        end: ev.getEndTime()
    }));

    return ContentService.createTextOutput(JSON.stringify(eventList))
        .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
    const data = JSON.parse(e.postData.contents);
    const cal = CalendarApp.getDefaultCalendar();

    try {
        const event = cal.createEvent(
            data.title,
            new Date(data.startTime),
            new Date(data.endTime),
            { description: data.description }
        );

        return ContentService.createTextOutput(JSON.stringify({ status: 'success', id: event.getId() }))
            .setMimeType(ContentService.MimeType.JSON);
    } catch (error) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}
