const tasks = [
  { title: "确认试点名单", completed: true },
  { title: "准备管理员培训", completed: false },
];

const form = document.querySelector("#task-form");
const input = document.querySelector("#task-input");
const list = document.querySelector("#task-list");
const remaining = document.querySelector("#remaining-count");

function render() {
  list.replaceChildren();
  for (const task of tasks) {
    const item = document.createElement("li");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.completed;
    checkbox.addEventListener("change", () => {
      task.completed = checkbox.checked;
      render();
    });
    item.append(checkbox, document.createTextNode(task.title));
    list.append(item);
  }
  remaining.textContent = String(tasks.length);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
});

render();
