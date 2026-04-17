import { RouterProvider } from "react-router";
import { ThemeProvider } from "./context/ThemeContext";
import { router } from "./routes";
import "../styles/index.css";

export default function App() {
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}
