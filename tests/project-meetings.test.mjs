import test from 'node:test';
import assert from 'node:assert/strict';
import {MEET_URL,localToIso,renderMeetingRow,meetingWhen} from '../project-meetings.mjs';

const meeting=(over={})=>({id:'m1',title:'Review <store>',meet_url:'https://meet.google.com/abc-defg-hij',starts_at:'2026-11-12T20:00:00Z',time_zone:'America/Lima',mail_status:'none',...over});

test('only Google Meet links are accepted',()=>{
 assert.ok(MEET_URL.test('https://meet.google.com/abc-defg-hij'));
 for(const bad of ['http://meet.google.com/abc-defg-hij','https://meet.google.com/abc','https://evil.example/abc-defg-hij'])assert.ok(!MEET_URL.test(bad));
});

test('the local date and time become an exact moment for the API',()=>{
 assert.match(localToIso('2026-11-12T15:00'),/^2026-11-12T\d\d:00:00\.000Z$/);
 assert.equal(localToIso(''),'');
});

test('a meeting row escapes its topic, shows its time zone and offers the invitation until it is sent',()=>{
 const html=renderMeetingRow(meeting());
 assert.match(html,/Review &lt;store&gt;/);assert.doesNotMatch(html,/<store>/);
 assert.match(html,/America\/Lima/);assert.match(html,/data-meeting-invite="m1"/);assert.match(html,/data-meeting-join="m1"/);
 const sent=renderMeetingRow(meeting({mail_status:'sent'}));
 assert.doesNotMatch(sent,/data-meeting-invite/);assert.match(sent,/badge ok/);
 assert.doesNotMatch(renderMeetingRow(meeting({mail_status:'uncertain'})),/data-meeting-invite/);  // Never sent twice.
 assert.match(meetingWhen(meeting()),/America\/Lima/);
});

test("a past meeting keeps TeTrato's help under the line it answered, without counting it as a line", async () => {
 const {renderRecordRow, recordConversationHtml} = await import("../project-meetings.mjs");
 const record = {id: "r2", title: "Review", created_at: "2026-11-10T10:00:00Z", summary: {}, transcript: [{speaker: "client", text: "Can we add reservations?"}, {speaker: "tetrato-answer", text: "Offer it as <new> work."}, {speaker: "you", text: "New work."}]};
 const talk = recordConversationHtml(record);
 assert.match(talk, /class="ma-help is-answer"/); assert.match(talk, /Offer it as &lt;new&gt; work\./);
 assert.ok(talk.indexOf("reservations") < talk.indexOf("Offer it") && talk.indexOf("Offer it") < talk.indexOf("New work."));
 assert.match(talk, /\(2\)/);
 assert.match(renderRecordRow(record), /· 2 /);
});

test("a past meeting shows in the tray with what TeTrato kept, and its conversation stays folded", async () => {
 const {renderRecordRow, recordConversationHtml} = await import("../project-meetings.mjs");
 const record = {id: "r1", title: "Review <store>", created_at: "2026-11-10T10:00:00Z", summary: {decisions: ["a"], risks: ["b", "c"]}, transcript: [{speaker: "client", text: "Hola <b>"}, {speaker: "you", text: "Sí"}]};
 const row = renderRecordRow(record);
 assert.match(row, /Review &lt;store&gt;/); assert.match(row, /data-meeting-record="r1"/);
 const talk = recordConversationHtml(record);
 assert.match(talk, /<details/); assert.doesNotMatch(talk, /<details[^>]* open/);
 assert.match(talk, /Hola &lt;b&gt;/); assert.match(talk, /is-mine/);
});
