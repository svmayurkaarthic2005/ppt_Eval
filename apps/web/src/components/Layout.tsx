import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { signOutAdmin } from "../lib/supabaseClient";
import { useAdminAuth } from "../lib/useAdminAuth";

const NAV_LINKS = [{ to: "/", label: "Leaderboard & Rankings", end: true }];

const ADMIN_NAV_LINKS = [
  { to: "/upload", label: "Upload Deck", end: false },
  { to: "/admin/calibration", label: "Human Calibration", end: false },
];

export default function Layout() {
  const { isAdmin, email } = useAdminAuth();
  const navigate = useNavigate();
  const navLinks = isAdmin ? [...NAV_LINKS, ...ADMIN_NAV_LINKS] : NAV_LINKS;

  async function handleLogout() {
    await signOutAdmin();
    navigate("/");
  }

  return (
    <div className="min-h-screen bg-slate-50/70 text-slate-900 flex flex-col font-sans">
      <header className="sticky top-0 z-50 stitch-glass border-b border-slate-200/80 transition-all">
        <nav className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 py-3">
          {/* Brand */}
          <NavLink to="/" className="group flex shrink-0 items-center gap-2.5 transition">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-sm font-extrabold text-white">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <span className="font-extrabold tracking-tight text-slate-900 text-lg group-hover:text-indigo-600 transition">
                HackEval
              </span>
              <p className="hidden text-[11px] font-medium text-slate-600 -mt-0.5 sm:block">
                Automated Hackathon Jury
              </p>
            </div>
          </NavLink>

          {/* Navigation Pill Bar -- edge-faded so a cut-off tab (e.g.
              "Human Ca...ibration" on narrow screens) visibly hints that
              there's more to scroll, instead of just looking clipped. */}
          <div className="flex min-w-0 max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-slate-200/60 bg-slate-100/80 p-1 shadow-inner [mask-image:linear-gradient(to_right,black_92%,transparent_100%)]">
            {navLinks.map((link) => (
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

          {/* Status Indicator -- stays visible on mobile (just the dot, no
              label) instead of disappearing entirely below md, since
              engine status is worth knowing at any viewport width. */}
          <div className="flex shrink-0 items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-emerald-200/80 bg-emerald-50/70 px-2 sm:px-3 py-1 text-xs font-semibold text-emerald-800 shadow-sm">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
              </span>
              <span className="hidden sm:inline">Engine Online</span>
            </div>

            {isAdmin ? (
              <button
                type="button"
                onClick={handleLogout}
                title={email ?? "Admin"}
                className="rounded-full border border-slate-200/80 bg-white px-2.5 sm:px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
              >
                Logout
              </button>
            ) : (
              <NavLink
                to="/login"
                className="rounded-full border border-slate-200/80 bg-white px-2.5 sm:px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
              >
                Admin Login
              </NavLink>
            )}
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
