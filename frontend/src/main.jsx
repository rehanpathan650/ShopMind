import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { Analytics } from "@vercel/analytics/react"
import { SpeedInsights } from "@vercel/speed-insights/react"
import "./styles.css";
createRoot(document.getElementById("root")).render(
<>
 <App />
 <Analytics />
 <SpeedInsights />
</>
);
