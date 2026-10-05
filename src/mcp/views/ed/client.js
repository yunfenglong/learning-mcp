/** Runs only inside the sandboxed MCP App. Keep dependencies inside this function:
 * the Worker imports its text; it is never executed on the server.
 * Source strings are rendered with textContent. Practice answers remain local.
 */
(() => {
  const root = document.getElementById("view");
  let requestId = 1;
  function node(tag, text, parent = root) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = String(text);
    parent.appendChild(el);
    return el;
  }
  function detail(title, parent = root) {
    const el = node("details", undefined, parent);
    node("summary", title, el);
    return el;
  }
  function render(result) {
    root.replaceChildren();
    const data = result.structuredContent || {};
    const v = data.view || {};
    node("h1", v.course || v.lesson?.title || "Course reading");
    if (data.coverage)
      node(
        "p",
        "Coverage: " +
          data.coverage +
          "; " +
          (data.page_cap || 10) +
          " upstream pages maximum",
      );
    if (v.kind === "lesson_progress") {
      for (const m of v.modules || []) {
        const el = detail(
          m.name +
            " — " +
            m.completed +
            "/" +
            m.total +
            (m.openedAt ? "" : " (not released)"),
        );
        const bar = node("progress", undefined, el);
        bar.max = m.total;
        bar.value = m.completed;
        for (const l of m.unfinished || [])
          node("p", l.title + " · " + l.status, el);
      }
    } else if (v.kind === "forum_catchup") {
      for (const t of [...(v.announcements || []), ...(v.threads || [])]) {
        const el = detail(
          "#" + t.number + " " + t.title + (t.seen ? "" : " · unread"),
        );
        node("p", t.excerpt || t.createdAt, el);
      }
    } else if (v.kind === "thread_activity") {
      const buckets = new Map();
      for (const t of v.threads || []) {
        const date = new Date(t.createdAt);
        const dow = (date.getUTCDay() + 6) % 7;
        date.setUTCDate(date.getUTCDate() - dow);
        const key = date.toISOString().slice(0, 10);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(t);
      }
      const max = Math.max(1, ...[...buckets.values()].map((a) => a.length));
      for (const [week, threads] of [...buckets].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const el = detail(week + " — " + threads.length + " threads");
        const bar = node("progress", undefined, el);
        bar.max = max;
        bar.value = threads.length;
        for (const t of threads)
          node("p", "#" + t.number + " " + t.title + " · " + t.category, el);
      }
    } else if (v.kind === "lesson_guide") {
      let step = 0;
      const card = node("section");
      const draw = () => {
        card.replaceChildren();
        const s = v.sections[step];
        node("h2", step + 1 + ". " + s.title, card);
        for (const p of s.points) node("p", p, card);
        for (const [label, delta] of [
          ["Previous", -1],
          ["Next", 1],
        ]) {
          const b = node("button", label, card);
          b.disabled = step + delta < 0 || step + delta >= v.sections.length;
          b.onclick = () => {
            step += delta;
            draw();
          };
        }
      };
      draw();
      node(
        "p",
        "Original practice only; answers stay in this view and are never sent to Ed.",
      );
      for (const q of v.quiz || []) {
        const el = detail(q.question);
        const feedback = node("p", "", el);
        q.options.forEach((option, index) => {
          const b = node("button", option, el);
          b.onclick = () => {
            feedback.textContent =
              (index === q.answer ? "Correct. " : "Try again. ") + q.why;
          };
        });
      }
    } else node("pre", data.text || JSON.stringify(data, null, 2));
    window.parent.postMessage(
      {
        jsonrpc: "2.0",
        method: "ui/notifications/size-changed",
        params: { height: document.documentElement.scrollHeight },
      },
      "*",
    );
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const m = event.data;
    if (m?.method === "ui/notifications/tool-result") render(m.params);
    if (m?.id === 1 && m.result)
      window.parent.postMessage(
        { jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} },
        "*",
      );
  });
  window.parent.postMessage(
    {
      jsonrpc: "2.0",
      id: requestId,
      method: "ui/initialize",
      params: {
        protocolVersion: "2026-01-26",
        appInfo: { name: "Learning read view", version: "1.0.0" },
        appCapabilities: {},
      },
    },
    "*",
  );
})();
