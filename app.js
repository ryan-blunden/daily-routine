    (async () => {
      const STORAGE_PREFIX = "daily-setlist-state-v1:";
      const PLAN_SNAPSHOT_PREFIX = "daily-setlist-plan-v1:";
      const titleEl = document.getElementById("planner-title");
      const dateControlEl = document.getElementById("date-control");
      const todayDateEl = document.getElementById("today-date");
      const datePickerEl = document.getElementById("date-picker");
      const headerProgressEl = document.querySelector(".header-progress");
      const goalsEl = document.getElementById("daily-goals");
      const deliverablesEl = document.getElementById("top-deliverables");
      const scheduleEl = document.getElementById("schedule");
      const percentEl = document.getElementById("tasks-percent");
      const goalsPercentEl = document.getElementById("goals-percent");
      const deliverablesPercentEl = document.getElementById("deliverables-percent");

      const toLocalISODate = (d) => {
        const off = d.getTimezoneOffset();
        const local = new Date(d.getTime() - off * 60000);
        return local.toISOString().slice(0, 10);
      };

      const isValidISODate = (value) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
        const [year, month, day] = value.split("-").map(Number);
        const dt = new Date(Date.UTC(year, month - 1, day));
        return dt.getUTCFullYear() === year && dt.getUTCMonth() + 1 === month && dt.getUTCDate() === day;
      };

      const formatDateLabel = (isoDate) => {
        const [year, month, day] = isoDate.split("-").map(Number);
        return new Intl.DateTimeFormat("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric"
        }).format(new Date(year, month - 1, day));
      };

      const resolveSelectedDate = () => {
        const todayISO = toLocalISODate(new Date());
        const raw = new URLSearchParams(window.location.search).get("date");
        return isValidISODate(raw) ? raw : todayISO;
      };

      const selectedDate = resolveSelectedDate();
      const todayISO = toLocalISODate(new Date());

      const navigateToDate = (isoDate) => {
        const url = new URL(window.location.href);
        if (isoDate === todayISO) {
          url.searchParams.delete("date");
        } else {
          url.searchParams.set("date", isoDate);
        }
        window.location.assign(url.toString());
      };

      const readPlanSnapshot = (isoDate) => {
        const raw = localStorage.getItem(PLAN_SNAPSHOT_PREFIX + isoDate);
        if (!raw) return null;
        try {
          return normalizePlannerData(JSON.parse(raw));
        } catch (_) {
          return null;
        }
      };

      const writePlanSnapshot = (isoDate, plannerData) => {
        localStorage.setItem(PLAN_SNAPSHOT_PREFIX + isoDate, JSON.stringify(plannerData));
      };

      const slug = (s) =>
        s
          .toString()
          .toLowerCase()
          .replace(/&/g, "and")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");

      const unquote = (s) => {
        if (!s) return "";
        const q = s.trim();
        if (q.startsWith('"') && q.endsWith('"')) {
          return q
            .slice(1, -1)
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\");
        }
        return q;
      };

      const parseTomlValue = (raw) => {
        const value = raw.trim();
        if (value.startsWith("[") && value.endsWith("]")) {
          const inner = value.slice(1, -1).trim();
          if (!inner) return [];
          const matches = inner.match(/"((?:\\"|[^"])*)"/g) || [];
          return matches.map((m) => unquote(m));
        }
        if (value === "true") return true;
        if (value === "false") return false;
        if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
        return unquote(value);
      };

      const parseTomlPlanner = (toml) => {
        const data = { blocks: [] };
        let currentBlock = null;
        const lines = toml.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          const rawLine = lines[i];
          const line = rawLine.replace(/\s+#.*$/, "").trim();
          if (!line) continue;
          if (line === "[[blocks]]") {
            currentBlock = { title: "", time: "", items: [] };
            data.blocks.push(currentBlock);
            continue;
          }
          const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
          if (!match) continue;
          const [, key, initialRawValue] = match;
          let rawValue = initialRawValue;

          if (rawValue.trim().startsWith("[") && !rawValue.trim().endsWith("]")) {
            const parts = [rawValue];
            while (i + 1 < lines.length) {
              i += 1;
              const nextLine = lines[i].replace(/\s+#.*$/, "").trim();
              if (!nextLine) continue;
              parts.push(nextLine);
              if (nextLine.endsWith("]")) break;
            }
            rawValue = parts.join(" ");
          }

          const target = currentBlock || data;
          target[key] = parseTomlValue(rawValue);
        }
        return data;
      };

      const normalizePlannerData = (raw) => {
        const blocks = Array.isArray(raw?.blocks)
          ? raw.blocks.map((b) => ({
              title: String(b?.title || ""),
              time: String(b?.time || ""),
              description: String(b?.description || ""),
              items: Array.isArray(b?.items) ? b.items.map((i) => String(i)) : []
            }))
          : [];

        return {
          titlePrefix: String(raw?.title_prefix || "DAILY"),
          titleAccent: String(raw?.title_accent || "SETLIST"),
          goals: Array.isArray(raw?.goals) ? raw.goals.map((g) => String(g)) : [],
          topDeliverables: Array.isArray(raw?.top_deliverables) ? raw.top_deliverables.map((d) => String(d)) : [],
          blocks
        };
      };

      const fetchText = async (path) => {
        const res = await fetch(path, { cache: "no-store" });
        if (!res.ok) throw new Error(`Unable to load ${path}`);
        return res.text();
      };

      const loadPlannerData = async () => {
        try {
          const tomlText = await fetchText("planner-data.toml");
          return normalizePlannerData(parseTomlPlanner(tomlText));
        } catch (_) {
          const jsonText = await fetchText("planner-data.json");
          return normalizePlannerData(JSON.parse(jsonText));
        }
      };

      const setHeaderTitle = (titlePrefix, titleAccent) => {
        titleEl.textContent = "";
        titleEl.append(document.createTextNode(`${titlePrefix} `));
        const accent = document.createElement("strong");
        accent.textContent = titleAccent;
        titleEl.append(accent);
      };

      const renderDescriptionHtml = (el, html) => {
        const template = document.createElement("template");
        template.innerHTML = String(html || "");
        const allowedTags = new Set(["B", "STRONG", "I", "EM", "U", "SMALL", "CODE", "BR", "SPAN", "A"]);
        const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
        const replaceWithText = [];

        while (walker.nextNode()) {
          const node = walker.currentNode;
          const tag = node.tagName;
          if (!allowedTags.has(tag)) {
            replaceWithText.push(node);
            continue;
          }

          [...node.attributes].forEach((attr) => {
            const name = attr.name.toLowerCase();
            const value = attr.value.trim();
            const isAnchorAttr = tag === "A" && (name === "href" || name === "target" || name === "rel");
            if (name.startsWith("on")) {
              node.removeAttribute(attr.name);
            } else if (tag === "A" && name === "href" && /^\s*javascript:/i.test(value)) {
              node.removeAttribute("href");
            } else if (!isAnchorAttr && name !== "class") {
              node.removeAttribute(attr.name);
            }
          });

          if (tag === "A") {
            if (!node.getAttribute("target")) node.setAttribute("target", "_blank");
            node.setAttribute("rel", "noopener noreferrer");
          }
        }

        replaceWithText.forEach((node) => {
          node.replaceWith(document.createTextNode(node.textContent || ""));
        });

        el.replaceChildren(template.content.cloneNode(true));
      };

      const renderBlocks = (blocks) => {
        scheduleEl.textContent = "";
        const desktopColumns = 3;
        const scheduleRows = Math.max(1, Math.ceil(blocks.length / desktopColumns));
        scheduleEl.style.setProperty("--schedule-rows", String(scheduleRows));
        blocks.forEach((block, blockIndex) => {
          const article = document.createElement("article");
          article.className = "block";

          const heading = document.createElement("h2");
          heading.textContent = block.title;

          const time = document.createElement("p");
          time.className = "time";
          time.textContent = block.time;

          const desc = document.createElement("p");
          desc.className = "desc";
          renderDescriptionHtml(desc, block.description);

          const list = document.createElement("ul");
          const cappedItems = block.items.slice(0, 4);
          cappedItems.forEach((item, itemIndex) => {
            const li = document.createElement("li");
            li.setAttribute("role", "group");

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            const taskId = `${blockIndex}-${slug(block.title)}-${itemIndex}`;
            checkbox.dataset.taskId = taskId;
            checkbox.id = `task-${taskId}`;
            checkbox.name = `task-${taskId}`;
            checkbox.setAttribute("aria-label", item);

            const label = document.createElement("label");
            label.className = "task-text task-label";
            label.textContent = item;
            label.htmlFor = checkbox.id;

            li.append(checkbox, label);
            list.append(li);
          });

          article.append(heading, time, desc, list);
          scheduleEl.append(article);
        });
      };

      const renderGoals = (goals) => {
        goalsEl.textContent = "";
        goals.forEach((goal, goalIndex) => {
          const li = document.createElement("li");
          li.setAttribute("role", "group");

          const goalText = String(goal).trim();
          const goalMatch = goalText.match(/^(\d{1,3})\s+(.+)$/);
          const target = goalMatch ? Number(goalMatch[1]) : 0;

          const goalInput = document.createElement("input");
          goalInput.type = "text";
          goalInput.className = "goal-count";
          goalInput.inputMode = "numeric";
          goalInput.pattern = "[0-9]*";
          goalInput.autocomplete = "off";
          goalInput.placeholder = "00";
          const goalId = `goal-${goalIndex}-${slug(goal)}`;
          goalInput.dataset.taskId = goalId;
          goalInput.dataset.goalTarget = String(target);
          goalInput.id = `task-${goalId}`;
          goalInput.name = `task-${goalId}`;
          goalInput.setAttribute("aria-label", goal);

          const label = document.createElement("label");
          label.className = "task-text task-label";
          label.textContent = goalText;
          label.htmlFor = goalInput.id;

          const counterWrap = document.createElement("div");
          counterWrap.className = "goal-count-wrap";
          counterWrap.append(goalInput);

          li.append(counterWrap, label);
          goalsEl.append(li);
        });
      };

      const renderDeliverables = (deliverables) => {
        deliverablesEl.textContent = "";
        deliverables.slice(0, 3).forEach((item, itemIndex) => {
          const li = document.createElement("li");
          li.setAttribute("role", "group");

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          const taskId = `deliverable-${itemIndex}-${slug(item)}`;
          checkbox.dataset.taskId = taskId;
          checkbox.id = `task-${taskId}`;
          checkbox.name = `task-${taskId}`;
          checkbox.setAttribute("aria-label", item);

          const label = document.createElement("label");
          label.className = "task-text task-label";
          label.textContent = item;
          label.htmlFor = checkbox.id;

          li.append(checkbox, label);
          deliverablesEl.append(li);
        });
      };

      todayDateEl.textContent = formatDateLabel(selectedDate);
      datePickerEl.value = selectedDate;
      const keyForDate = () => STORAGE_PREFIX + selectedDate;
      const getStateInputs = () => [...document.querySelectorAll('[data-task-id]')];
      const getTaskCheckboxes = () => [...document.querySelectorAll('.schedule li input[type="checkbox"]')];

      const readState = () => {
        const raw = localStorage.getItem(keyForDate());
        if (!raw) return {};
        try {
          return JSON.parse(raw);
        } catch (_) {
          return {};
        }
      };

      const writeState = () => {
        const payload = {};
        getStateInputs().forEach((el) => {
          if (el.type === "checkbox") {
            payload[el.dataset.taskId] = el.checked;
          } else {
            const digits = String(el.value || "").replace(/\D/g, "").slice(0, 2);
            payload[el.dataset.taskId] = digits ? Number(digits) : 0;
          }
        });
        localStorage.setItem(keyForDate(), JSON.stringify(payload));
      };

      const updateMetrics = () => {
        const checks = getTaskCheckboxes();
        const total = checks.length;
        const done = checks.filter((cb) => cb.checked).length;
        const percent = total ? Math.round((done / total) * 100) : 0;
        percentEl.textContent = `${percent}%`;
        if (headerProgressEl) {
          headerProgressEl.style.setProperty("--progress", `${percent}%`);
        }

        checks.forEach((cb) => {
          const text = cb.nextElementSibling;
          if (text) text.classList.toggle("done", cb.checked);
        });

        const deliverableChecks = [...document.querySelectorAll('.deliverables-list input[type="checkbox"]')];
        const deliverablesTotal = deliverableChecks.length;
        const deliverablesDone = deliverableChecks.filter((cb) => cb.checked).length;
        const deliverablesPercent = deliverablesTotal ? Math.round((deliverablesDone / deliverablesTotal) * 100) : 0;
        if (deliverablesPercentEl) deliverablesPercentEl.textContent = `(${deliverablesPercent}%)`;
        deliverableChecks.forEach((cb) => {
          const text = cb.nextElementSibling;
          if (text) text.classList.toggle("done", cb.checked);
        });

        const goalInputs = [...document.querySelectorAll(".goals-list .goal-count[data-task-id]")];
        const goalsTotal = goalInputs.length;
        let goalsDone = 0;
        goalInputs.forEach((input) => {
          const target = Number(input.dataset.goalTarget || "0");
          const value = Number(input.value || "0");
          const isDone = target > 0 ? value >= target : value > 0;
          if (isDone) goalsDone += 1;
          const label = input.closest("li")?.querySelector(".task-label");
          if (label) label.classList.toggle("done", isDone);
        });
        const goalsPercent = goalsTotal ? Math.round((goalsDone / goalsTotal) * 100) : 0;
        if (goalsPercentEl) goalsPercentEl.textContent = `(${goalsPercent}%)`;
      };

      const loadState = () => {
        const state = readState();
        getStateInputs().forEach((el) => {
          const saved = state[el.dataset.taskId];
          if (el.type === "checkbox") {
            el.checked = Boolean(saved);
          } else {
            const digits = String(saved ?? "").replace(/\D/g, "").slice(0, 2);
            el.value = digits;
          }
        });
        updateMetrics();
      };

      document.addEventListener("change", (e) => {
        if (e.target.matches('input[type="checkbox"], input.goal-count')) {
          writeState();
          updateMetrics();
        }
      });

      document.addEventListener("input", (e) => {
        if (!e.target.matches("input.goal-count")) return;
        const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
        e.target.value = digits;
        writeState();
        updateMetrics();
      });

      todayDateEl.addEventListener("click", () => {
        const isOpen = dateControlEl.classList.contains("open");
        dateControlEl.classList.toggle("open", !isOpen);
        if (!isOpen) datePickerEl.focus();
      });

      datePickerEl.addEventListener("change", () => {
        const picked = datePickerEl.value;
        if (!isValidISODate(picked) || picked === selectedDate) return;
        navigateToDate(picked);
      });

      document.addEventListener("click", (e) => {
        if (!dateControlEl.contains(e.target)) {
          dateControlEl.classList.remove("open");
        }
      });

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          dateControlEl.classList.remove("open");
          todayDateEl.focus();
        }
      });

      const livePlannerData = await loadPlannerData();
      let plannerData = readPlanSnapshot(selectedDate);

      if (!plannerData) {
        plannerData = livePlannerData;
        writePlanSnapshot(selectedDate, plannerData);
      } else if (selectedDate === todayISO) {
        // Keep today's plan aligned with the source file unless user navigates to past dates.
        plannerData = livePlannerData;
        writePlanSnapshot(selectedDate, plannerData);
      }

      setHeaderTitle(plannerData.titlePrefix, plannerData.titleAccent);
      renderGoals(plannerData.goals);
      renderDeliverables(plannerData.topDeliverables);
      renderBlocks(plannerData.blocks);
      loadState();
    })();
