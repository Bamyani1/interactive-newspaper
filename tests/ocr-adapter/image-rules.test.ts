import { describe, it, expect } from "vitest";
import {
  isAdImageDescription,
  isBodyMostlyCaption,
  doesLastParagraphMatchAnyCaption,
} from "@/src/server/ocr-adapter/image-rules";

describe("isAdImageDescription", () => {
  it("returns true for 'advertisement titled' pattern", () => {
    expect(
      isAdImageDescription(
        "advertisement titled 'Super Featured Edibles' listing dining specials and hours for various campus locations",
      ),
    ).toBe(true);
  });

  it("returns true for 'advertisement for' pattern", () => {
    expect(
      isAdImageDescription("advertisement for Domino's Pizza delivery specials"),
    ).toBe(true);
  });

  it("returns false for a normal article headline", () => {
    expect(isAdImageDescription("Bishops pull past Big Red")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isAdImageDescription("")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(
      isAdImageDescription("Advertisement Titled 'Campus Bookstore Sale'"),
    ).toBe(true);
  });

  it("ignores leading/trailing whitespace", () => {
    expect(
      isAdImageDescription("  advertisement for Joe's Diner  "),
    ).toBe(true);
  });

  it("returns true for section header description", () => {
    expect(
      isAdImageDescription("Sports section header for the Ohio Wesleyan Transcript."),
    ).toBe(true);
  });

  it("returns true for AI-generated cartoon illustration description", () => {
    expect(
      isAdImageDescription(
        "A cartoon illustration of a character holding a fraternity pennant with the text 'says : HI MOMS!'",
      ),
    ).toBe(true);
  });

  it("returns true for masthead logo description", () => {
    expect(
      isAdImageDescription("the Ohio College Newspaper Association logo within the newspaper's masthead"),
    ).toBe(true);
  });

  it("returns true for nameplate logo description", () => {
    expect(
      isAdImageDescription("The Transcript nameplate logo"),
    ).toBe(true);
  });

  it("returns false for article about a logo", () => {
    expect(
      isAdImageDescription("University unveils new logo design"),
    ).toBe(false);
  });
});

describe("isBodyMostlyCaption", () => {
  it("returns true for short body matching caption", () => {
    const text = "Mayor Smith accepts the award at city hall";
    expect(isBodyMostlyCaption(text, text)).toBe(true);
  });

  it("returns true for long body matching caption (>200 chars)", () => {
    const longText =
      "Delaware Mayor John Smith was honored as Citizen of the Year at a ceremony held at city hall on Saturday evening. " +
      "The award recognizes his decades of service to the community, including his work on the downtown revitalization project, " +
      "the new community center, and his tireless advocacy for local schools and parks. Friends and family gathered to celebrate. " +
      "His wife Martha and their three children were all in attendance to share the moment. " +
      "Councilwoman Jane Doe presented the award and praised his leadership.";
    expect(longText.length).toBeGreaterThan(200);
    expect(isBodyMostlyCaption(longText, longText)).toBe(true);
  });

  it("returns true when body is a substring of caption with >80% ratio", () => {
    const caption =
      "Delaware Mayor John Smith accepts the Citizen of the Year award at city hall on Saturday";
    const body =
      "Delaware Mayor John Smith accepts the Citizen of the Year award at city hall";
    expect(isBodyMostlyCaption(body, caption)).toBe(true);
  });

  it("returns false for long body NOT matching caption", () => {
    const body =
      "The Ohio Wesleyan University Board of Trustees met on Friday to discuss the upcoming academic year. " +
      "Several new initiatives were proposed including expanded financial aid programs and a new dormitory construction project. " +
      "The meeting lasted three hours and concluded with a unanimous vote to proceed with the plans.";
    const caption = "Mayor Smith accepts the award at city hall";
    expect(isBodyMostlyCaption(body, caption)).toBe(false);
  });

  it("returns false for empty body", () => {
    expect(isBodyMostlyCaption("", "Some caption")).toBe(false);
  });

  it("returns false when ratio is below 0.8", () => {
    const body = "Short";
    const caption =
      "A much longer caption that has no relation to the short body text at all";
    expect(isBodyMostlyCaption(body, caption)).toBe(false);
  });

  it("normalizes whitespace before comparing", () => {
    const body = "Mayor  Smith   accepts\n the  award";
    const caption = "Mayor Smith accepts the award";
    expect(isBodyMostlyCaption(body, caption)).toBe(true);
  });

  it("returns true when body has trailing OCR punctuation artifact", () => {
    const body =
      "BISHOP HURLER Dave Rees is shown working against Capital in OWU's 4-3 loss on Tuesday afternoon at Selby Field. Rees pitched a strong game for the Bishops. .";
    const caption =
      "BISHOP HURLER Dave Rees is shown working against Capital in OWU's 4-3 loss on Tuesday afternoon at Selby Field. Rees pitched a strong game for the Bishops. See baseball story on page 19.";
    expect(isBodyMostlyCaption(body, caption)).toBe(true);
  });
});

describe("doesLastParagraphMatchAnyCaption", () => {
  it("returns true when last paragraph matches a caption", () => {
    const body =
      "First paragraph of article text.\n\nMayor Smith accepts the award at city hall on Saturday evening";
    const captions = [
      "Mayor Smith accepts the award at city hall on Saturday evening",
    ];
    expect(doesLastParagraphMatchAnyCaption(body, captions)).toBe(true);
  });

  it("returns false for single-paragraph body", () => {
    const body =
      "Mayor Smith accepts the award at city hall on Saturday evening";
    const captions = [
      "Mayor Smith accepts the award at city hall on Saturday evening",
    ];
    expect(doesLastParagraphMatchAnyCaption(body, captions)).toBe(false);
  });

  it("returns false when no captions match", () => {
    const body =
      "First paragraph.\n\nCompletely different second paragraph text here";
    const captions = ["Unrelated caption about a different topic entirely"];
    expect(doesLastParagraphMatchAnyCaption(body, captions)).toBe(false);
  });
});
