import { URL } from "node:url";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

class Element {
  children: Element[] = [];
  textContent = "";
  onclick?: () => unknown;
  constructor(readonly tag: string) {}
  appendChild(child: Element) {
    this.children.push(child);
  }
  replaceChildren() {
    this.children = [];
  }
}
function widget() {
  const root = new Element("main"),
    sent: any[] = [];
  let listener: (event: any) => void;
  const parent = { postMessage: (m: unknown) => sent.push(m) };
  runInNewContext(
    readFileSync(
      new URL("../src/mcp/views/ed/client.js", import.meta.url),
      "utf8",
    ),
    {
      window: {
        parent,
        addEventListener: (_: string, fn: typeof listener) => (listener = fn),
      },
      document: {
        getElementById: () => root,
        createElement: (tag: string) => new Element(tag),
        documentElement: { scrollHeight: 200 },
      },
      setTimeout,
      clearTimeout,
    },
  );
  const send = (data: unknown, source: unknown = parent) =>
    listener!({ source, data });
  const nodes = (el: Element = root): Element[] => [
    el,
    ...el.children.flatMap(nodes),
  ];
  const button = (text: string) =>
    nodes().find((n) => n.tag === "button" && n.textContent === text)!;
  return { root, sent, send, button, nodes };
}

describe("Ed interactive view host boundary", () => {
  it("requires a real button click and binds answer reads to the linked course", async () => {
    const w = widget();
    const result = {
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: {
        structuredContent: {
          unit: "linked-course",
          view: {
            kind: "forum_catchup",
            threads: [
              {
                id: 11,
                number: 42,
                type: "question",
                title: "<script>untrusted</script>",
              },
            ],
          },
        },
      },
    };
    w.send(result, {});
    expect(w.root.children).toHaveLength(0);
    w.send(result);
    expect(
      w.sent.filter((m) => ["tools/call", "ui/message"].includes(m.method)),
    ).toEqual([]);
    const clicking = w.button("Read answer").onclick!();
    const call = w.sent.at(-1);
    expect(call).toMatchObject({
      method: "tools/call",
      params: {
        name: "ed_thread",
        arguments: {
          unit: "linked-course",
          thread_id: 11,
          include_html: false,
        },
      },
    });
    w.send({
      jsonrpc: "2.0",
      id: call.id,
      result: {
        structuredContent: {
          answers: [{ document: "Answer text", endorsed: true }],
        },
      },
    });
    await clicking;
    expect(w.nodes().some((n) => n.textContent === "Answer text")).toBe(true);
    expect(w.nodes().some((n) => n.tag === "script")).toBe(false);
  });
  it("sends study requests through the host and displays host rejection", async () => {
    const w = widget();
    w.send({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: {
        structuredContent: {
          unit: "linked-course",
          view: { kind: "lesson_progress", modules: [] },
        },
      },
    });
    const clicking = w.button("Discuss in chat").onclick!();
    const call = w.sent.at(-1);
    expect(call).toMatchObject({
      method: "ui/message",
      params: { role: "user", content: [{ type: "text" }] },
    });
    w.send({ jsonrpc: "2.0", id: call.id, error: { code: -32601 } });
    await clicking;
    expect(w.nodes().some((n) => n.textContent.includes("unavailable"))).toBe(
      true,
    );
  });
});
