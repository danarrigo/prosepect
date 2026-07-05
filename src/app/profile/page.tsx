import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getUserByEmail } from "@/app/db/queries/users";

export default async function ProfilePage() {
  const session = await auth();
  
  if (!session?.user?.email) {
    redirect("/login");
  }

  const user = await getUserByEmail(session.user.email);
  if (!user) {
    redirect("/login");
  }

  const joinDate = user.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : "Recently";

  return (
    <div className="min-h-screen w-full bg-[#FDF9EF] flex flex-col items-center pt-24 px-6 md:px-12 pb-32">
      <div className="w-full max-w-[800px] flex flex-col gap-12">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row items-center md:items-end justify-between border-b border-[#C4C6CD] pb-8 gap-6">
          <div className="flex items-center gap-8 flex-col md:flex-row text-center md:text-left">
            <div className="w-32 h-32 rounded-full overflow-hidden bg-[#041729] flex items-center justify-center shrink-0 shadow-md">
              {user.image ? (
                <img src={user.image} alt={user.name || "Profile"} className="w-full h-full object-cover" />
              ) : (
                <span className="text-[#FDF9EF] font-noto text-5xl">{user.name?.charAt(0)?.toUpperCase() || "?"}</span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <h1 className="text-[#041729] font-noto text-[48px] leading-tight tracking-[-1px]">{user.name}</h1>
              <p className="text-[#5F5E5E] text-[14px] font-semibold tracking-[1.2px] uppercase">Member since {joinDate}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <form action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}>
              <button type="submit" className="px-6 py-2 border border-[#041729] text-[#041729] text-sm font-semibold tracking-[1.4px] uppercase hover:bg-[#041729] hover:text-[#FDF9EF] transition-colors rounded-sm cursor-pointer">
                Sign Out
              </button>
            </form>
          </div>
        </div>

        {/* Content Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          
          {/* Account Details */}
          <div className="flex flex-col gap-6">
            <h2 className="text-[#041729] font-noto text-[24px]">Account Details</h2>
            <div className="flex flex-col gap-4 bg-[#F7F3E9] p-6 rounded-sm border border-[#E6E2D8] shadow-sm">
              <div className="flex flex-col gap-1">
                <span className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase">Email Address</span>
                <span className="text-[#041729] text-[16px]">{user.email}</span>
              </div>
              <div className="flex flex-col gap-1 mt-4">
                <span className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase">Full Name</span>
                <span className="text-[#041729] text-[16px]">{user.name}</span>
              </div>
            </div>
          </div>

          {/* Activity / Preferences placeholder */}
          <div className="flex flex-col gap-6">
            <h2 className="text-[#041729] font-noto text-[24px]">My Library</h2>
            <div className="flex flex-col items-center justify-center gap-4 bg-[#F7F3E9] p-8 rounded-sm border border-[#E6E2D8] shadow-sm min-h-[160px] text-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#C4C6CD" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
              </svg>
              <p className="text-[#5F5E5E] text-[14px]">Your personal collection is currently empty.</p>
              <a href="/curated" className="text-[#041729] text-[12px] font-semibold tracking-[1px] uppercase border-b border-[#041729] pb-0.5 hover:text-[#5F5E5E] hover:border-[#5F5E5E] transition-colors mt-2">
                Browse Curated
              </a>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
