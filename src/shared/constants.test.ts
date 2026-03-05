import { describe, it, expect } from "vitest";
import { COMMITMENT_REGEX } from "./constants";

describe("COMMITMENT_REGEX", () => {
  const shouldMatch = [
    "I'll send that over after lunch",
    "I will get back to you tomorrow",
    "Let me look into that",
    "I can have it ready by Friday",
    "I could do that by EOD",
    "Action item: review the proposal",
    "Can you review the PR?",
    "Could you send me the spec?",
    "Let's follow up on this next week",
    "I'll circle back with an update",
    "Send you the report by Monday",
    "Let me schedule a meeting for that",
    "I'll set up a call with the team",
    "I need to look into this issue",
    "Let me take a look at the code",
    "I'll check on the deployment status",
    "Can you review the design doc?",
    "I'll get that to you by tomorrow",
    "Clyde, add that to my list",
    "That's one for Clyde",
    "clyde remind me about this",
  ];

  const shouldNotMatch = [
    "Hello, how are you?",
    "The meeting is at 3pm",
    "Thanks for the update",
    "Sounds good to me",
    "Great presentation today",
    "Happy Friday everyone!",
    "Who's joining the standup?",
    "Nice work on the feature",
    "Let's grab lunch",
    "See you in the morning",
  ];

  it.each(shouldMatch)("matches: %s", (text) => {
    expect(COMMITMENT_REGEX.test(text)).toBe(true);
  });

  it.each(shouldNotMatch)("does not match: %s", (text) => {
    expect(COMMITMENT_REGEX.test(text)).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(COMMITMENT_REGEX.test("I'LL SEND THAT OVER")).toBe(true);
    expect(COMMITMENT_REGEX.test("CLYDE add this")).toBe(true);
  });
});
