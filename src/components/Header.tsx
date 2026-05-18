"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export default function Header() {
  const { user, logout } = useAuth();
  const router = useRouter();

  function handleLogout() {
    logout();
    router.push("/auth");
  }

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
              />
            </svg>
          </div>
          <span className="font-bold text-gray-900 text-sm sm:text-base hidden xs:block">
            Land Management
          </span>
        </Link>

        {user && (
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-gray-600 truncate max-w-[200px]">
              {user.name}
            </span>
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-semibold text-sm flex-shrink-0">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-900 transition-colors px-2 py-1 rounded hover:bg-gray-100"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
