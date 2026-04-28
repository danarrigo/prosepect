export default function Library() {
    return (
        <div className="min-h-screen w-full bg-[#FDF9EF]">
            <div className="flex w-full flex-col items-center">
                {/* Main Container */}
                <div className="flex w-full max-w-[1400px] flex-col items-start px-6 md:px-12 py-12 md:py-16 gap-8 md:gap-12">

                    {/* Hero Header Section */}
                    <div className="flex flex-col gap-4 md:gap-6 w-full mt-4 md:mt-0">
                        <h1 className="text-[#041729] font-noto text-[48px] md:text-[64px] font-normal tracking-[-2px] md:tracking-[-2.56px]">Library</h1>
                        <p className="text-[#5F5E5E] text-[16px] md:text-[18px] max-w-2xl leading-relaxed">
                            A sanctuary for the written word. Browse our digital shelves of rare editions, curated classics, and modern masterpieces.
                        </p>
                    </div>

                    {/* Section - Refined Filtering */}
                    <div className="flex flex-col xl:flex-row w-full justify-between items-start xl:items-center bg-[#F7F3E9] p-4 rounded-sm border border-[#E6E2D8] gap-6 xl:gap-0">
                        <div className="flex flex-col lg:flex-row gap-6 lg:gap-12 items-start lg:items-center w-full xl:w-auto">
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                                <span className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase whitespace-nowrap">GENRE</span>
                                <div className="flex flex-wrap gap-2">
                                    <button className="px-4 py-2 bg-[#041729] text-[#FDF9EF] rounded-sm text-sm">All Works</button>
                                    <button className="px-4 py-2 text-[#5F5E5E] hover:text-[#041729] text-sm transition-colors">Classic Literature</button>
                                    <button className="px-4 py-2 text-[#5F5E5E] hover:text-[#041729] text-sm transition-colors">Philosophy</button>
                                    <button className="px-4 py-2 text-[#5F5E5E] hover:text-[#041729] text-sm transition-colors">Poetry</button>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase whitespace-nowrap">ERA</span>
                                <button className="flex items-center gap-2 text-[#041729] text-sm font-medium hover:opacity-70 transition-opacity">
                                    Contemporary
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
                                </button>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <span className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase whitespace-nowrap">SORT BY</span>
                            <button className="flex items-center gap-2 text-[#041729] text-sm font-medium hover:opacity-70 transition-opacity">
                                Recent Acquisitions
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
                            </button>
                        </div>
                    </div>

                    {/* Section - Library Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 w-full">
                        {/* Book Card 1 */}
                        <div className="flex flex-col gap-4 col-span-1">
                            <div className="w-full aspect-[2/3] bg-gray-200 rounded-sm overflow-hidden shadow-sm">
                                <img src="/book1.png" className="w-full h-full object-cover" alt="The Philosophy of Silence" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <p className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase">CLASSIC LITERATURE</p>
                                <h3 className="text-[#041729] font-noto text-[20px] leading-tight mt-1">The Philosophy of Silence</h3>
                                <p className="text-[#5F5E5E] text-[12px] mt-1">Marcus Aurelius</p>
                            </div>
                        </div>

                        {/* Book Card 2 */}
                        <div className="flex flex-col gap-4 col-span-1">
                            <div className="w-full aspect-[2/3] bg-gray-200 rounded-sm overflow-hidden shadow-sm">
                                <img src="/book2.png" className="w-full h-full object-cover" alt="A Room of One's Own" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <p className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase">MODERN ESSAY</p>
                                <h3 className="text-[#041729] font-noto text-[20px] leading-tight mt-1">A Room of One's Own</h3>
                                <p className="text-[#5F5E5E] text-[12px] mt-1">Virginia Woolf</p>
                            </div>
                        </div>

                        {/* Featured Large Book Card (Col Span 1 to 2) */}
                        <div className="flex flex-col md:flex-row col-span-1 sm:col-span-2 bg-[#F7F3E9] rounded-sm border border-[#E6E2D8] overflow-hidden p-6 md:p-8 gap-6 md:gap-8 items-center">
                            <div className="w-full md:w-[240px] shrink-0 aspect-[2/3] bg-gray-200 rounded-sm overflow-hidden shadow-md">
                                <img src="/mainbook.png" className="w-full h-full object-cover" alt="Beyond the Shadow of Doubt" />
                            </div>
                            <div className="flex flex-col gap-4 md:gap-6 justify-center">
                                <p className="text-[#041729] text-[10px] font-bold tracking-[1.5px] uppercase">THE CURATOR'S CHOICE</p>
                                <h3 className="text-[#041729] font-noto text-[32px] md:text-[40px] leading-[1.1] tracking-[-1px]">Beyond the<br />Shadow of<br />Doubt</h3>
                                <p className="text-[#5F5E5E] text-[14px] leading-relaxed italic">
                                    "A masterpiece of 19th-century prose that challenges the very boundaries of the intellect and the human spirit."
                                </p>
                                <div className="flex flex-wrap gap-4 mt-2">
                                    <button className="bg-[#041729] text-[#FDF9EF] px-6 py-3 rounded-sm text-[12px] font-semibold tracking-[1.2px] uppercase hover:opacity-90 transition-opacity">Read Now</button>
                                    <button className="border border-[#041729] text-[#041729] px-6 py-3 rounded-sm text-[12px] font-semibold tracking-[1.2px] uppercase hover:bg-[#041729] hover:text-[#FDF9EF] transition-colors">Add to Notebook</button>
                                </div>
                            </div>
                        </div>

                        {/* Book Card 3 */}
                        <div className="flex flex-col gap-4 col-span-1">
                            <div className="w-full aspect-[2/3] bg-gray-200 rounded-sm overflow-hidden shadow-sm">
                                <img src="/book3.png" className="w-full h-full object-cover" alt="The Art of Worldmaking" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <p className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase">PHILOSOPHY</p>
                                <h3 className="text-[#041729] font-noto text-[20px] leading-tight mt-1">The Art of Worldmaking</h3>
                                <p className="text-[#5F5E5E] text-[12px] mt-1">Nelson Goodman</p>
                            </div>
                        </div>

                        {/* Book Card 4 */}
                        <div className="flex flex-col gap-4 col-span-1">
                            <div className="w-full aspect-[2/3] bg-gray-200 rounded-sm overflow-hidden shadow-sm">
                                <img src="/book4.png" className="w-full h-full object-cover" alt="Great Expectations" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <p className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase">VICTORIAN ERA</p>
                                <h3 className="text-[#041729] font-noto text-[20px] leading-tight mt-1">Great Expectations</h3>
                                <p className="text-[#5F5E5E] text-[12px] mt-1">Charles Dickens</p>
                            </div>
                        </div>

                        {/* Book Card 5 */}
                        <div className="flex flex-col gap-4 col-span-1">
                            <div className="w-full aspect-[2/3] bg-gray-200 rounded-sm overflow-hidden shadow-sm">
                                <img src="/leftbook.png" className="w-full h-full object-cover" alt="Notes on the Archipelago" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <p className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase">ANTHOLOGY</p>
                                <h3 className="text-[#041729] font-noto text-[20px] leading-tight mt-1">Notes on the Archipelago</h3>
                                <p className="text-[#5F5E5E] text-[12px] mt-1">Various Authors</p>
                            </div>
                        </div>

                        {/* Book Card 6 */}
                        <div className="flex flex-col gap-4 col-span-1">
                            <div className="w-full aspect-[2/3] bg-gray-200 rounded-sm overflow-hidden shadow-sm">
                                <img src="/rightbook.png" className="w-full h-full object-cover" alt="The Lost Manuscripts" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <p className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase">ARCHIVAL RECOVERY</p>
                                <h3 className="text-[#041729] font-noto text-[20px] leading-tight mt-1">The Lost Manuscripts</h3>
                                <p className="text-[#5F5E5E] text-[12px] mt-1">Anonymous Curator</p>
                            </div>
                        </div>
                    </div>

                    {/* Pagination / Load More */}
                    <div className="flex w-full justify-center pt-8 pb-16 md:pb-24 border-t border-[#E6E2D8] mt-4 md:mt-8">
                        <button className="flex items-center gap-2 text-[#041729] text-[12px] font-semibold tracking-[1.2px] uppercase hover:opacity-70 transition-opacity">
                            DISCOVER MORE
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                        </button>
                    </div>

                </div>
            </div>
        </div>
    )
}