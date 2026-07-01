export class UserDataController {
    async history(options) { if (!chrome.history)
        throw new Error("history permission unavailable"); return chrome.history.search({ text: options.text ?? "", maxResults: options.maxResults ?? 20, startTime: options.startTime, endTime: options.endTime }); }
    async bookmarksSearch(query) { if (!chrome.bookmarks)
        throw new Error("bookmarks permission unavailable"); return chrome.bookmarks.search(query); }
    async bookmarksCreate(input) { if (!chrome.bookmarks)
        throw new Error("bookmarks permission unavailable"); return chrome.bookmarks.create(input); }
    async topSites() { if (!chrome.topSites)
        throw new Error("topSites permission unavailable"); return chrome.topSites.get(); }
    async readingListQuery() { if (!chrome.readingList)
        throw new Error("readingList permission unavailable"); return chrome.readingList.query({}); }
    async sessionsRecentlyClosed() { if (!chrome.sessions)
        throw new Error("sessions permission unavailable"); return chrome.sessions.getRecentlyClosed(); }
}
