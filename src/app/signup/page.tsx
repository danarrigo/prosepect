import Image from "next/image";
import Link from "next/link";
import { signUp } from "../lib/users/actions";
import { signIn } from "../../auth";

export default function SignupPage() {
  return (
    <main className="min-h-screen relative flex flex-col items-center justify-center bg-[#FDF9EF] overflow-hidden px-4 py-20">
      {/* Background Layers */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/signup-bg1.png"
          alt="Vintage paper texture"
          fill
          className="object-cover opacity-20"
          priority
        />
        <Image
          src="/signup-bg2.png"
          alt="Artistic overlay texture"
          fill
          className="object-cover opacity-10"
          priority
        />
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

        {/* Registration Card - Enhanced Glassmorphism */}
        <div className="w-full bg-white/70 backdrop-blur-[16px] border border-white/40 shadow-[0px_24px_48px_rgba(4,23,41,0.08)] rounded-sm p-8 sm:p-10 flex flex-col gap-8 transition-all duration-500">
          <form className="flex flex-col w-full gap-6" action={signUp}>
            {/* Full Name Field */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="fullName"
                className="font-noto text-sm text-[#041729] tracking-[0.025em] hover:scale-101 transition-all duration-300"
              >
                Full Name
              </label>
              <div className="bg-[#ECE8DE]/80 rounded-sm px-4 py-[13px] border border-[#041729]/5 focus-within:border-[#041729]/20 transition-all">
                <input
                  type="text"
                  id="fullName"
                  name="fullName"
                  placeholder="J. Doe"
                  className="w-full bg-transparent border-none outline-none font-sans text-base text-[#041729] placeholder:text-[#C4C6CD]"
                />
              </div>
            </div>

            {/* Email Field */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="email"
                className="font-noto text-sm text-[#041729] tracking-[0.025em] hover:scale-101 transition-all duration-300"
              >
                Email Address
              </label>
              <div className="bg-[#ECE8DE]/80 rounded-sm px-4 py-[13px] border border-[#041729]/5 focus-within:border-[#041729]/20 transition-all">
                <input
                  type="email"
                  id="email"
                  name="email"
                  placeholder="j.doe@example.com"
                  className="w-full bg-transparent border-none outline-none font-sans text-base text-[#041729] placeholder:text-[#C4C6CD]"
                />
              </div>
            </div>

            {/* Passphrase Field */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="passphrase"
                className="font-noto text-sm text-[#041729] tracking-[0.025em] hover:scale-101 transition-all duration-300"
              >
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
                background:
                  "radial-gradient(circle at 50% 50%, #041729 0%, #1A2C3E 100%)",
              }}
            >
              <span className="font-sans font-medium text-sm tracking-[0.0571em] uppercase">
                Begin Your Curatorship
              </span>
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center w-full gap-4">
            <div className="flex-1 h-[1px] bg-[#041729]/10"></div>
            <span className="font-sans text-xs text-[#5F5E5E] tracking-[0.1em] uppercase">OR</span>
            <div className="flex-1 h-[1px] bg-[#041729]/10"></div>
          </div>

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

          {/* Horizontal Border & Footer Link */}
          <div className="border-t border-[#041729]/10 pt-6 w-full flex justify-center">
            <Link
              href="/login"
              className="font-sans font-medium text-sm text-[#5F5E5E] hover:text-[#041729] transition-colors"
            >
              Already have a key? Enter the sanctuary.
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
