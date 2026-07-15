import AskWorkspace from "./AskWorkspace";

// Revalidate the server-provided daily prompt seed without letting the client
// clock diverge from the HTML that React hydrates.
export const revalidate = 3_600;

export default function AskPage() {
    const suggestionDate = new Date().toISOString().slice(0, 10);
    return <AskWorkspace suggestionDate={suggestionDate} />;
}
