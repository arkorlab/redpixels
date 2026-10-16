# Gmail mobile compatibility record

Status: **partially executed on 2026-10-16**. A tester operated the real iOS Gmail app; the draft and received MIME were inspected through the Gmail API. Android remains untested. API/unit tests alone are not compatibility evidence.

| Platform | OS / Gmail version          | Image in initial draft | After edit + save                | In received MIME                  | After recipient viewing | Pre-view origin fetches |
| -------- | --------------------------- | ---------------------- | -------------------------------- | --------------------------------- | ----------------------- | ----------------------- |
| iOS      | iOS 26 / Gmail not recorded | retained               | retained; `src` changed to proxy | retained; original `src` restored | pending                 | 4                       |
| Android  | —                           | untested               | untested                         | untested                          | untested                | untested                |

## Observed iOS case

- Device/OS reported by the tester: iPhone, iOS 26. Hardware model and Gmail version were not recorded.
- One HTML draft was created through the Gmail API with a unique 1px image, then addressed to the same Gmail account. The tester opened it twice, changed a text line, saved, and sent it manually from the Gmail app.
- The saved draft contained the edited text and image. Gmail had rewritten `src` to a `googleusercontent.com` image proxy URL with the original URL in its fragment.
- The delivered message had `SENT`, `INBOX`, and `UNREAD` labels before the recipient-viewing step. Its decoded raw MIME contained the edited text and a 1px image whose `src` was the original tracking URL.
- Two Google image proxy fetches were recorded after the initial draft openings, three by the edit/save checkpoint, and four after sending but before recipient viewing. All four had matching signed webhooks accepted by a receiver that verified HMAC, timestamp, and event ID. Requests carried `google_image_proxy` but no self-open classification.
- Separately, the deployed backend recorded two direct GETs and delivered two signature-verified notifications. HEAD did not count; unauthenticated history and a correctly formatted but invalid HMAC were rejected with 401.
- This does not verify a separate recipient account, all Gmail versions, replies, formatting changes, Apple MPP, or every real opening. Pre-view proxy requests demonstrate that notifications can occur before recipient reading.

## Repeat the test

1. Register a fresh pixel for each case. Use accounts you control.
2. Create an HTML MIME draft and inspect `drafts.get?format=raw`; decode the HTML part and check the exact URL.
3. Edit/save on mobile, then inspect again. Test unchanged sending, replies and format switches separately.
4. Send and inspect the recipient's original MIME. Draft preservation and received-image preservation are separate checks.
5. Note pre-send/pre-view fetches, open on the receiving device, and compare UTC timestamps to history.
6. Reopen, change networks/devices, and record which requests reach the origin. No second fetch can result from caching and does not prove removal.
7. For Apple Mail, record MPP on/off and whether viewed. UA flags alone do not validate Apple provenance.
8. Record date, versions, pixel ID, timestamps, results and reproduction steps. Remove private MIME/tokens before sharing issues; delete test history when finished.

No emails are automatically sent by the test suite.
