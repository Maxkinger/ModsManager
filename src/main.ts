import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./style.css";

// 【防伪标识与授权声明】
console.info(
  "%c[mayflyMods 防伪声明]%c b战：清梦与狗不得使用，其他人随意使用，不过分抄袭套壳即可",
  "background:#c53030;color:#fff;font-weight:bold;padding:4px 8px;border-radius:4px;",
  "color:#fc8181;font-weight:bold;padding:4px;font-size:12px;"
);

createApp(App).use(createPinia()).mount("#app");
