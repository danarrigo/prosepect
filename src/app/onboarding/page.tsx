import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserByEmail } from "@/app/db/queries/users";
import { completeOnboarding } from "@/app/lib/users/actions";

export default async function OnboardingPage() {
  const session = await auth();
  
  if (!session?.user?.email) {
    redirect("/login");
  }

  const user = await getUserByEmail(session.user.email);
  if (!user) {
    redirect("/login");
  }

  if (user.handle) {
    redirect("/curated"); // Already onboarded
  }

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

      {/* Main Content */}
      <div className="relative z-10 w-full max-w-[512px] flex flex-col items-center gap-8">
        {/* Header */}
        <div className="flex flex-col items-center gap-2">
          <h1 className="font-noto text-4xl text-[#041729] tracking-[-0.05em] text-center">
            Welcome, Curator
          </h1>
          <p className="font-noto text-lg text-[#5F5E5E] tracking-[-0.025em] text-center">
            How should you be known in the sanctuary?
          </p>
        </div>

        {/* Onboarding Card */}
        <div className="w-full bg-white/70 backdrop-blur-[16px] border border-white/40 shadow-[0px_24px_48px_rgba(4,23,41,0.08)] rounded-sm p-8 sm:p-10 flex flex-col gap-8 transition-all duration-500">

          <form className="flex flex-col w-full gap-6" action={completeOnboarding}>
            
            {/* Display Name Field */}
            <div className="flex flex-col gap-2">
              <label htmlFor="name" className="font-noto text-sm text-[#041729] tracking-[0.025em] hover:scale-101 transition-all duration-300">
                Display Name
              </label>
              <div className="bg-[#ECE8DE]/80 rounded-sm px-4 py-[13px] border border-[#041729]/5 focus-within:border-[#041729]/20 transition-all">
                <input
                  type="text"
                  id="name"
                  name="name"
                  defaultValue={user.name || ""}
                  placeholder="John Doe"
                  className="w-full bg-transparent border-none outline-none font-sans text-base text-[#041729] placeholder:text-[#C4C6CD]"
                  required
                />
              </div>
            </div>

            {/* Handle Field */}
            <div className="flex flex-col gap-2">
              <label htmlFor="handle" className="font-noto text-sm text-[#041729] tracking-[0.025em] hover:scale-101 transition-all duration-300">
                Public Handle
              </label>
              <div className="bg-[#ECE8DE]/80 rounded-sm px-4 py-[13px] border border-[#041729]/5 focus-within:border-[#041729]/20 transition-all flex items-center">
                <span className="font-sans text-base text-[#74777D] mr-1">@</span>
                <input
                  type="text"
                  id="handle"
                  name="handle"
                  placeholder="scholar"
                  className="w-full bg-transparent border-none outline-none font-sans text-base text-[#041729] placeholder:text-[#C4C6CD]"
                  required
                  pattern="[a-zA-Z0-9_-]+"
                  title="Only letters, numbers, underscores, and dashes are allowed"
                />
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="mt-2 flex items-center justify-center w-full rounded-sm py-4 px-6 text-[#FFFFFF] shadow-[0px_12px_32px_0px_rgba(28,28,22,0.06)] hover:opacity-90 focus:outline-none hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
              style={{
                background: "radial-gradient(circle at 50% 50%, #041729 0%, #1A2C3E 100%)"
              }}
            >
              <span className="font-sans font-medium text-sm tracking-[0.0571em] uppercase">
                Claim Your Handle
              </span>
            </button>
          </form>

        </div>
      </div>
    </main>
  );
}
