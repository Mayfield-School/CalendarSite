const sampleEvents = [
  {
    date: "2026-10-19",
    start: "08:30",
    end: "09:15",
    title: "Week beginning assembly",
    category: "School Functions",
    location: "Sports Hall",
    description: "A sample whole-school gathering to begin the week together.",
  },
  {
    date: "2026-10-20",
    start: "15:45",
    end: "17:15",
    title: "U15 hockey fixture",
    category: "Sport",
    location: "Astro pitch",
    description: "A sample after-school fixture. Please check the live calendar for current team and travel details.",
  },
  {
    date: "2026-10-21",
    start: "08:15",
    end: "08:45",
    title: "Morning chapel",
    category: "Chaplaincy & Chapel",
    location: "Chapel",
    description: "A sample chapel gathering open to the school community.",
  },
  {
    date: "2026-10-21",
    start: "16:00",
    end: "17:00",
    title: "Senior choir rehearsal",
    category: "Dance, Drama & Music",
    location: "Music School",
    description: "A sample rehearsal for the senior choir.",
  },
  {
    date: "2026-10-22",
    start: "17:00",
    end: "19:00",
    title: "Year 9 parents' meeting",
    category: "Parents Meetings",
    location: "The Old Palace",
    description: "A sample opportunity for families to meet with their daughter's teachers.",
  },
  {
    date: "2026-10-23",
    start: "16:15",
    end: "18:00",
    title: "Autumn concert",
    category: "Dance, Drama & Music",
    location: "School Hall",
    description: "A sample evening concert celebrating music across the school.",
  },
  {
    date: "2026-10-24",
    start: "10:30",
    end: "12:00",
    title: "1st XI hockey",
    category: "Sport",
    location: "Astro pitch",
    description: "A sample Saturday fixture. Please check the live calendar for current team and travel details.",
  },
];

const state = {
  anchorDate: new Date(2026, 9, 19),
  view: "week",
  query: "",
};

const calendarView = document.querySelector("#calendar-view");
const periodLabel = document.querySelector("#period-label");
const eventCount = document.querySelector("#event-count");
const upcomingList = document.querySelector("#upcoming-list");
const categoryInputs = [...document.querySelectorAll(".category-option input")];
const searchInput = document.querySelector("#event-search");
const filterPanel = document.querySelector("#filter-panel");
const filterToggle = document.querySelector("#filter-toggle");
const eventDialog = document.querySelector("#event-dialog");

const weekdayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const shortWeekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function mondayOf(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - offset);
  return monday;
}

function addDays(date, count) {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(date, options) {
  return new Intl.DateTimeFormat("en-GB", options).format(date);
}

function timeLabel(time) {
  const [hour, minute] = time.split(":").map(Number);
  const date = new Date(2000, 0, 1, hour, minute);
  return formatDate(date, { hour: "numeric", minute: "2-digit" }).toLowerCase();
}

function selectedCategories() {
  return new Set(categoryInputs.filter((input) => input.checked).map((input) => input.value));
}

function matchingEvents() {
  const categories = selectedCategories();
  const query = state.query.trim().toLocaleLowerCase();
  return sampleEvents
    .filter((event) => categories.has(event.category))
    .filter((event) => {
      const text = `${event.title} ${event.category} ${event.location}`.toLocaleLowerCase();
      return text.includes(query);
    })
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));
}

function displayEventsForDate(events, date) {
  return events.filter((event) => event.date === dateKey(date));
}

function makeEventButton(event, compact = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = compact ? "month-event" : "event-card";
  button.dataset.category = event.category;
  button.setAttribute("aria-label", `${event.title}, ${timeLabel(event.start)}, ${event.location}`);

  if (compact) {
    button.textContent = `${timeLabel(event.start)} ${event.title}`;
  } else {
    const time = document.createElement("span");
    time.className = "event-time";
    time.textContent = `${timeLabel(event.start)} – ${timeLabel(event.end)}`;

    const title = document.createElement("span");
    title.className = "event-title";
    title.textContent = event.title;

    const place = document.createElement("span");
    place.className = "event-place";
    place.textContent = event.location;

    button.append(time, title, place);
  }

  button.addEventListener("click", () => openEventDetails(event));
  return button;
}

function openEventDetails(event) {
  document.querySelector("#dialog-category").textContent = event.category;
  document.querySelector("#dialog-title").textContent = event.title;
  document.querySelector("#dialog-date").textContent =
    `${formatDate(new Date(`${event.date}T12:00:00`), { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${timeLabel(event.start)}–${timeLabel(event.end)}`;
  document.querySelector("#dialog-location").textContent = event.location;
  document.querySelector("#dialog-description").textContent = event.description;
  eventDialog.showModal();
}

function renderWeek(events) {
  const firstDay = mondayOf(state.anchorDate);
  const grid = document.createElement("div");
  grid.className = "week-grid";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Week view");

  weekdayNames.forEach((weekday, index) => {
    const date = addDays(firstDay, index);
    const dayEvents = displayEventsForDate(events, date);
    const column = document.createElement("section");
    column.className = "day-column";
    if (dateKey(date) === dateKey(new Date())) column.classList.add("is-today");
    column.setAttribute("aria-label", `${weekday}, ${formatDate(date, { day: "numeric", month: "long" })}`);

    const heading = document.createElement("div");
    heading.className = "day-heading";
    const name = document.createElement("span");
    name.className = "day-name";
    name.textContent = shortWeekdays[index];
    const number = document.createElement("span");
    number.className = "day-number";
    number.textContent = date.getDate();
    heading.append(name, number);

    const eventList = document.createElement("div");
    eventList.className = "day-events";
    if (dayEvents.length) {
      dayEvents.forEach((event) => eventList.append(makeEventButton(event)));
    } else {
      const empty = document.createElement("span");
      empty.className = "empty-day";
      empty.textContent = "—";
      eventList.append(empty);
    }
    column.append(heading, eventList);
    grid.append(column);
  });

  calendarView.append(grid);
}

function renderMonth(events) {
  const year = state.anchorDate.getFullYear();
  const month = state.anchorDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = mondayOf(firstOfMonth);
  const grid = document.createElement("div");
  grid.className = "month-grid";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Month view");

  shortWeekdays.forEach((weekday) => {
    const heading = document.createElement("div");
    heading.className = "month-weekday";
    heading.textContent = weekday;
    grid.append(heading);
  });

  for (let index = 0; index < 42; index += 1) {
    const date = addDays(gridStart, index);
    const dayEvents = displayEventsForDate(events, date);
    const day = document.createElement("div");
    day.className = "month-day";
    if (date.getMonth() !== month) day.classList.add("is-outside");
    if (dateKey(date) === dateKey(new Date())) day.classList.add("is-today");

    const number = document.createElement("div");
    number.className = "month-day-number";
    number.textContent = date.getDate();
    day.append(number);
    dayEvents.slice(0, 2).forEach((event) => day.append(makeEventButton(event, true)));
    if (dayEvents.length > 2) {
      const more = document.createElement("span");
      more.className = "month-event-more";
      more.textContent = `+${dayEvents.length - 2} more`;
      day.append(more);
    }
    grid.append(day);
  }
  calendarView.append(grid);
}

function renderAgenda(events) {
  const list = document.createElement("div");
  list.className = "agenda-list";
  const firstDay = mondayOf(state.anchorDate);

  weekdayNames.forEach((weekday, index) => {
    const date = addDays(firstDay, index);
    const dayEvents = displayEventsForDate(events, date);
    if (!dayEvents.length) return;

    const day = document.createElement("section");
    day.className = "agenda-day";
    const dateLabel = document.createElement("div");
    dateLabel.className = "agenda-date";
    dateLabel.textContent = `${weekday}, ${formatDate(date, { day: "numeric", month: "short" })}`;
    const dayList = document.createElement("div");
    dayList.className = "agenda-day-events";

    dayEvents.forEach((event) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "agenda-event";
      const time = document.createElement("time");
      time.textContent = timeLabel(event.start);
      const title = document.createElement("strong");
      title.textContent = event.title;
      const category = document.createElement("span");
      category.textContent = event.category;
      button.append(time, title, category);
      button.addEventListener("click", () => openEventDetails(event));
      dayList.append(button);
    });
    day.append(dateLabel, dayList);
    list.append(day);
  });

  calendarView.append(list);
}

function renderUpcoming(events) {
  upcomingList.replaceChildren();
  const todayKey = dateKey(new Date());
  const nextEvents = events.filter((event) => event.date >= todayKey).slice(0, 3);
  const visibleEvents = nextEvents.length ? nextEvents : events.slice(0, 3);

  visibleEvents.forEach((event) => {
    const date = new Date(`${event.date}T12:00:00`);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "upcoming-item";
    const dateBox = document.createElement("span");
    dateBox.className = "upcoming-date";
    const month = document.createElement("span");
    month.textContent = shortMonths[date.getMonth()];
    const day = document.createElement("span");
    day.textContent = date.getDate();
    dateBox.append(month, day);
    const copy = document.createElement("span");
    copy.className = "upcoming-item-copy";
    const title = document.createElement("strong");
    title.textContent = event.title;
    const time = document.createElement("small");
    time.textContent = `${timeLabel(event.start)} · ${event.category}`;
    copy.append(title, time);
    button.append(dateBox, copy);
    button.addEventListener("click", () => openEventDetails(event));
    upcomingList.append(button);
  });
}

function updatePeriodLabel() {
  if (state.view === "month") {
    periodLabel.textContent = formatDate(state.anchorDate, { month: "long", year: "numeric" });
    return;
  }
  const firstDay = mondayOf(state.anchorDate);
  const lastDay = addDays(firstDay, 6);
  const firstMonth = formatDate(firstDay, { month: "short" });
  const lastMonth = formatDate(lastDay, { month: "short" });
  periodLabel.textContent =
    firstDay.getMonth() === lastDay.getMonth()
      ? `${firstDay.getDate()}–${lastDay.getDate()} ${lastMonth} ${lastDay.getFullYear()}`
      : `${firstDay.getDate()} ${firstMonth} – ${lastDay.getDate()} ${lastMonth} ${lastDay.getFullYear()}`;
}

function render() {
  const events = matchingEvents();
  updatePeriodLabel();
  calendarView.replaceChildren();
  eventCount.textContent = `${events.length} ${events.length === 1 ? "event" : "events"}${state.query ? " found" : ""}`;

  if (state.view === "week") renderWeek(events);
  if (state.view === "month") renderMonth(events);
  if (state.view === "list") renderAgenda(events);
  renderUpcoming(events);
}

function changePeriod(amount) {
  if (state.view === "month") {
    state.anchorDate = new Date(state.anchorDate.getFullYear(), state.anchorDate.getMonth() + amount, 1);
  } else {
    state.anchorDate = addDays(state.anchorDate, amount * 7);
  }
  render();
}

document.querySelector("#previous-period").addEventListener("click", () => changePeriod(-1));
document.querySelector("#next-period").addEventListener("click", () => changePeriod(1));
document.querySelector("#today-button").addEventListener("click", () => {
  state.anchorDate = new Date();
  render();
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    document.querySelectorAll("[data-view]").forEach((viewButton) => {
      viewButton.setAttribute("aria-pressed", String(viewButton === button));
    });
    document.querySelector("#previous-period").setAttribute("aria-label", `Previous ${state.view}`);
    document.querySelector("#next-period").setAttribute("aria-label", `Next ${state.view}`);
    render();
  });
});

categoryInputs.forEach((input) => input.addEventListener("change", render));

document.querySelector("#select-all").addEventListener("click", (event) => {
  const hasSelection = categoryInputs.some((input) => input.checked);
  categoryInputs.forEach((input) => {
    input.checked = !hasSelection;
  });
  event.currentTarget.textContent = hasSelection ? "Select all" : "Clear";
  render();
});

searchInput.addEventListener("input", () => {
  state.query = searchInput.value;
  render();
});

filterToggle.addEventListener("click", () => {
  const isOpen = filterPanel.classList.toggle("is-open");
  filterToggle.setAttribute("aria-expanded", String(isOpen));
});

function closeFilters() {
  filterPanel.classList.remove("is-open");
  filterToggle.setAttribute("aria-expanded", "false");
}

document.querySelector("#close-filters").addEventListener("click", closeFilters);
filterPanel.addEventListener("click", (event) => {
  if (event.target === filterPanel) closeFilters();
});

document.querySelector("#dialog-close").addEventListener("click", () => eventDialog.close());
eventDialog.addEventListener("click", (event) => {
  if (event.target === eventDialog) eventDialog.close();
});

render();
