# Gmail mobile compatibility record

Status: **not executed**. Fill this from real devices; API/unit tests are not compatibility evidence.

| Platform | OS / Gmail version | Image in initial draft | After edit + save | In received MIME | Recipient fetch | Repeat fetches |
| -------- | ------------------ | ---------------------- | ----------------- | ---------------- | --------------- | -------------- |
| iOS      | —                  | untested               | untested          | untested         | untested        | untested       |
| Android  | —                  | untested               | untested          | untested         | untested        | untested       |

1. Register a fresh pixel for each case. Use accounts you control.
2. Create an HTML MIME draft and inspect `drafts.get?format=raw`; decode the HTML part and check the exact URL.
3. Edit/save on mobile, then inspect again. Test unchanged sending, replies and format switches separately.
4. Send and inspect the recipient's original MIME. Draft preservation and received-image preservation are separate checks.
5. Note pre-send/pre-view fetches, open on the receiving device, and compare UTC timestamps to history.
6. Reopen, change networks/devices, and record which requests reach the origin. No second fetch can result from caching and does not prove removal.
7. For Apple Mail, record MPP on/off and whether viewed. UA flags alone do not validate Apple provenance.
8. Record date, versions, pixel ID, timestamps, results and reproduction steps. Remove private MIME/tokens before sharing issues; delete test history when finished.

No emails are automatically sent by the test suite.
