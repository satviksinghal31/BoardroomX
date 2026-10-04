const $ = (id) => document.getElementById(id);
let run = null,
  busy = false,
  lastState = null,
  connected = false,
  revision = 0;
const labels = {
  running: "Running",
  completed: "Completed",
  completed_with_failures: "Completed with failures",
  not_completed: "Not completed",
};
const date = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
function message(text, error = false) {
  $("message").textContent = text;
  $("message").className = "message" + (error ? " error" : "");
}
function render(state) {
  lastState = state;
  run = state.run;
  const running = run?.status === "running",
    total = run?.total ?? state.universe_total;
  $("start").disabled = busy || running || !state.universe_total;
  $("start").innerHTML = running
    ? "Running…"
    : '<span aria-hidden="true">▶</span> Start refresh';
  $("status").textContent = run ? labels[run.status] : "Ready";
  $("status").className = "tag " + (run?.status || "");
  $("processed").replaceChildren(
    document.createTextNode((run?.processed ?? 0).toLocaleString() + " "),
  );
  const denominator = document.createElement("span");
  denominator.textContent = "/ " + total.toLocaleString();
  $("processed").append(denominator);
  for (const field of ["successful", "failed"]) {
    $(field).textContent = (run?.[field] ?? 0).toLocaleString();
    $(field).classList.toggle("bad", field === "failed" && run?.failed > 0);
  }
  $("retry").textContent = (run?.awaiting_retry ?? 0).toLocaleString();
  $("retry").classList.toggle("waiting", run?.awaiting_retry > 0);
  $("progress").max = total || 1;
  $("progress").value = run?.processed ?? 0;
  $("percent").textContent =
    (total ? Math.floor(((run?.processed ?? 0) * 100) / total) : 0) + "%";
  $("current").textContent = running
    ? run.current_company
      ? "Currently fetching: " + run.current_company
      : run.pass === "retry"
        ? "Preparing retry pass…"
        : "Preparing next company…"
    : run?.status === "not_completed"
      ? "Run stopped. Start a new batch manually."
      : run
        ? "All companies covered."
        : state.universe_total + " active companies available in the database.";
  $("pass").textContent = run
    ? run.pass === "retry"
      ? "Retry"
      : "First pass"
    : "—";
  $("started").textContent = date(run?.started_at);
  $("finished").textContent = date(run?.finished_at);
  const failures = (run?.failures || []).filter((i) => i.status !== "fetching");
  $("failures").disabled = !failures.length;
  $("failure-list").replaceChildren();
  for (const item of failures) {
    const row = document.createElement("div");
    row.className = "failure-row";
    const heading = document.createElement("div");
    heading.className = "failure-heading";
    const symbol = document.createElement("strong");
    symbol.textContent = item.symbol;
    const meta = document.createElement("small");
    meta.textContent = `${item.attempts}/2 attempts · ${item.status === "failed" ? "Manual review" : "Awaiting retry"}`;
    heading.append(symbol, meta);
    const error = document.createElement("p");
    error.textContent = item.error || "Fetch did not complete";
    row.append(heading, error);
    $("failure-list").append(row);
  }
  message(
    run?.error ||
      (run?.status === "completed_with_failures"
        ? "Some companies need manual review. Their previous saved data was kept."
        : ""),
  );
}
async function refresh() {
  const version = revision;
  try {
    const response = await fetch("/api/screener/runs/current", {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Could not read progress");
    if (version !== revision) return;
    connected = true;
    render(data);
  } catch (e) {
    if (version !== revision) return;
    connected = false;
    $("start").disabled = true;
    message(e.message + ". Retrying connection…", true);
  }
}
$("start").addEventListener("click", async () => {
  if (busy || run?.status === "running") return;
  busy = true;
  revision++;
  $("start").disabled = true;
  message("Starting batch…");
  try {
    const response = await fetch("/api/screener/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Could not start refresh");
    run = data.run;
    await refresh();
  } catch (e) {
    message(e.message, true);
  } finally {
    busy = false;
    if (lastState)
      $("start").disabled =
        !connected || run?.status === "running" || !lastState.universe_total;
  }
});
$("collapse").addEventListener("click", () => {
  const collapsed = $("rail").classList.toggle("collapsed");
  $("collapse").setAttribute("aria-expanded", String(!collapsed));
  $("collapse").setAttribute(
    "aria-label",
    collapsed ? "Expand navigation" : "Collapse navigation",
  );
});
$("failures").addEventListener("click", () => $("drawer").showModal());
$("close").addEventListener("click", () => $("drawer").close());
$("drawer").addEventListener("click", (e) => {
  if (e.target === $("drawer")) {
    const r = $("drawer").getBoundingClientRect();
    if (e.clientY < r.top || e.clientX < r.left || e.clientX > r.right)
      $("drawer").close();
  }
});
refresh();
setInterval(refresh, 2000);
