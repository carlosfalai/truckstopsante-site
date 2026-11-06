# Facebook page campaign (Carlos, 2026-11-05)

Carlos: "tell each terminal to run their own ad campaign with remotion, except the America, who has to publish the shorts cutscenes with our songs."

- Page: Truck Stop Santé (page id 1362507173623379)
- Audience: trucking companies in Québec (fleet owners, dispatch) and their drivers. Truckers only, not all companies. Voice: Google Gemini TTS "Charon" with the Québécois style prompt (_scripts/arpq-tts.cjs, approved by Carlos for French trucker videos). Already posted: TSS-Ad-01 (reel 1351205860317296, 2026-11-04).
- Job: Run this project's own free campaign with Remotion videos: write the scripts, render (instanthpi-videos/ or this project's own Remotion setup), 9:16 Reel plus 1:1 or 16:9 Feed, 15 to 45 s, captions burned in. Art from this project's own approved images (STYLE-LOCK if it has one); voices through voiceq (audq) unless noted.

## Rules
- FREE page posts only. Never paid ads, never Boost, never the ad account (Carlos 2026-11-04: "dont pay facebook, just post on the web page"). A paused campaign was built by mistake once and deleted.
- Show Carlos each video and its caption before it goes up; post only after his go for that post.
- Post with the Graph API: page token FB_PAGE_TOKEN_<page id> in the master .env (permanent, never print it). Video: POST https://graph-video.facebook.com/v21.0/<page id>/videos with source, title, description, published=true; then check status ready and the permalink.
- No swear words in page names or posts. No emoji. One post a day per page at most.
- Keep the post list (date, file, caption, post id) in FACEBOOK-POSTS.md in this folder.
