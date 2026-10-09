import { NavLink, Outlet } from "react-router-dom";

const NAV_LINKS = [
  { to: "/", label: "Leaderboard & Rankings", end: true },
  { to: "/upload", label: "Upload Deck" },
  { to: "/admin/calibration", label: "Human Calibration" },
];

export default function Layout() {
  return (
    <div className="min-h-screen bg-slate-50/70 stitch-gradient-mesh text-slate-900 flex flex-col font-sans">
      <header className="sticky top-0 z-50 stitch-glass border-b border-slate-200/80 transition-all">
        <nav className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 py-3">
          {/* Brand */}
          <NavLink to="/" className="group flex shrink-0 items-center gap-2.5 transition">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-600 text-sm font-extrabold text-white shadow-md shadow-indigo-600/25 transition group-hover:scale-105 group-hover:shadow-indigo-600/40">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold tracking-tight text-slate-900 text-lg group-hover:text-indigo-600 transition">
                  HackEval
                </span>
                <span className="hidden rounded-full bg-indigo-100/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700 sm:inline-flex">
                  AI + S2
                </span>
              </div>
              <p className="hidden text-[11px] font-medium text-slate-600 -mt-0.5 sm:block">
                Automated Hackathon Jury
              </p>
            </div>
          </NavLink>

          {/* Navigation Pill Bar */}
          <div className="flex min-w-0 max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-slate-200/60 bg-slate-100/80 p-1 shadow-inner">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs sm:text-sm font-semibold transition-all duration-150 ${
                    isActive
                      ? "bg-white text-indigo-600 shadow-sm shadow-slate-200/50"
                      : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </div>

          {/* Status Indicator */}
          <div className="hidden md:flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-emerald-200/80 bg-emerald-50/70 px-3 py-1 text-xs font-semibold text-emerald-800 shadow-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
              </span>
              Engine Online
            </div>
          </div>
        </nav>
      </header>

      <div className="flex-1">
        <Outlet />
      </div>

      <footer className="border-t border-slate-200/60 bg-white/50 py-4 text-center text-xs text-slate-600">
        <div className="mx-auto max-w-[1440px] px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>HackEval Jury Suite &middot; Powered by Groq LLaMA & CrossRef IEEE</span>
          <span className="text-slate-500">Rigorous 20-Criteria Rubric + Literature Grounding</span>
        </div>
      </footer>
    </div>
  );
}
