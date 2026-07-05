import Image from "next/image";
import Link from "next/link";
import { login } from "../lib/users/actions";
import { signIn } from "../../auth";


export default function LoginPage() {
  return (
    <main className="min-h-screen relative flex flex-col items-center justify-center bg-[#FDF9EF] overflow-hidden px-4 py-20">
      {/* Background Layer */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/login-bg.png"
          alt="Abstract Book Element"
          fill
          className="object-cover opacity-20"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#FDF9EF]/0 to-[#FDF9EF]" />
      </div>

      {/* Watermark Quote - Over the card (z-20) */}
      <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none select-none overflow-hidden px-4">
        <div className="flex flex-col items-center opacity-[0.04] animate-watermark">
          <p className="font-noto text-[120px] sm:text-[180px] font-bold text-[#041729] leading-tight text-center max-w-[1200px]">
            A reader lives a thousand lives before he dies.
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="relative z-10 w-full max-w-[512px] flex flex-col items-center gap-8">
        {/* Header */}
        <div className="flex flex-col items-center gap-2">
          <h1 className="font-noto text-4xl text-[#041729] tracking-[-0.05em] text-center">
            Prosepect
          </h1>
          <p className="font-noto text-lg text-[#5F5E5E] tracking-[-0.025em] text-center">
            The Digital Curator
          </p>
        </div>

        {/* Login Card - Enhanced Glassmorphism */}
        <div className="w-full bg-white/70 backdrop-blur-[16px] border border-white/40 shadow-[0px_24px_48px_rgba(4,23,41,0.08)] rounded-sm p-8 sm:p-10 flex flex-col gap-8 transition-all duration-500">

          <form className="flex flex-col w-full gap-6" action={login}>
            {/* Email Field */}
            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="font-noto text-sm text-[#041729] tracking-[0.025em] hover:scale-101 transition-all duration-300">
                Email Address
              </label>
              <div className="bg-[#ECE8DE]/80 rounded-sm px-4 py-[13px] border border-[#041729]/5 focus-within:border-[#041729]/20 transition-all">
                <input
                  type="email"
                  id="email"
                  name="email"
                  placeholder="scholar@example.com"
                  className="w-full bg-transparent border-none outline-none font-sans text-base text-[#041729] placeholder:text-[#C4C6CD]"
                />
              </div>
            </div>

            {/* Passphrase Field */}
            <div className="flex flex-col gap-2">
              <label htmlFor="passphrase" className="font-noto text-sm text-[#041729] tracking-[0.025em] hover:scale-101 transition-all duration-300">
                Passphrase
              </label>
              <div className="bg-[#ECE8DE]/80 rounded-sm px-4 py-[13px] border border-[#041729]/5 focus-within:border-[#041729]/20 transition-all">
                <input
                  type="password"
                  id="passphrase"
                  name="password"
                  placeholder="••••••••"
                  className="w-full bg-transparent border-none outline-none font-sans text-base text-[#041729] placeholder:text-[#C4C6CD]"
                />
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="flex items-center justify-center w-full rounded-sm py-4 px-6 text-[#FFFFFF] shadow-[0px_12px_32px_0px_rgba(28,28,22,0.06)] hover:opacity-90 focus:outline-none hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
              style={{
                background: "radial-gradient(circle at 50% 50%, #041729 0%, #1A2C3E 100%)"
              }}
            >
              <span className="font-sans font-medium text-sm tracking-[0.0571em] uppercase">
                Enter the Sanctuary
              </span>
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center w-full gap-4">
            <div className="flex-1 h-[1px] bg-[#041729]/10"></div>
            <span className="font-sans text-xs text-[#5F5E5E] tracking-[0.1em] uppercase">OR</span>
            <div className="flex-1 h-[1px] bg-[#041729]/10"></div>
          </div>

          <div className="flex flex-col gap-3 w-full">
            <form
              action={async () => {
                "use server";
                await signIn("google", {
                  redirectTo: "/curated",
                });
              }}
              className="w-full"
            >
              <button 
                type="submit"
                className="flex items-center justify-center w-full gap-3 rounded-sm py-4 px-6 bg-white/50 border border-[#041729]/10 shadow-[0px_4px_12px_rgba(4,23,41,0.03)] hover:bg-white focus:outline-none hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span className="font-sans font-medium text-sm text-[#041729] tracking-[0.0571em] uppercase">
                  Continue with Google
                </span>
              </button>
            </form>

            <form
              action={async () => {
                "use server";
                await signIn("github", {
                  redirectTo: "/curated",
                });
              }}
              className="w-full"
            >
              <button 
                type="submit"
                className="flex items-center justify-center w-full gap-3 rounded-sm py-4 px-6 bg-white/50 border border-[#041729]/10 shadow-[0px_4px_12px_rgba(4,23,41,0.03)] hover:bg-white focus:outline-none hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
              >
                <svg height="20" width="20" viewBox="0 0 16 16" fill="#041729">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
                </svg>
                <span className="font-sans font-medium text-sm text-[#041729] tracking-[0.0571em] uppercase">
                  Continue with GitHub
                </span>
              </button>
            </form>
          </div>

          {/* Horizontal Border & Footer Link */}
          <div className="border-t border-[#041729]/10 pt-6 w-full flex justify-center">
            <Link
              href="/signup"
              className="font-sans font-medium text-sm text-[#5F5E5E] hover:text-[#041729] transition-colors"
            >
              New here? Begin your curatorship.
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
