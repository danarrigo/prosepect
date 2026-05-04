"use client";

import { useState } from "react";

export default function Library() {
    const [activeGenre, setActiveGenre] = useState("All Works");
    const genres = ["All Works", "Classic Literature", "Philosophy", "Poetry"];
    return (
        <div className="min-h-screen w-full bg-[#FDF9EF]">
            {/* Desktop View */}
            <div className="hidden md:flex w-full flex-col items-center">
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
                                    {genres.map((genre) => (
                                        <button
                                            key={genre}
                                            onClick={() => setActiveGenre(genre)}
                                            className={`px-4 py-2 text-sm transition-colors rounded-sm ${activeGenre === genre ? "bg-[#041729] text-[#FDF9EF]" : "text-[#5F5E5E] hover:text-[#041729]"}`}
                                        >
                                            {genre}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase whitespace-nowrap">ERA</span>
                                <select className="flex items-center gap-2 text-[#041729] text-sm font-medium hover:opacity-70 transition-opacity">
                                    <option value="contemporary">Contemporary</option>
                                    <option value="classic">Classic Literature</option>
                                    <option value="philosophy">Philosophy</option>
                                    <option value="poetry">Poetry</option>
                                </select>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <span className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase whitespace-nowrap">SORT BY</span>
                            <div className="relative flex items-center group">
                                <select className="appearance-none bg-transparent pr-6 py-1 text-[#041729] text-sm font-medium hover:opacity-70 transition-opacity outline-none cursor-pointer w-full">
                                    <option value="recent">Recent Acquisitions</option>
                                    <option value="title">Title (A-Z)</option>
                                    <option value="author">Author (A-Z)</option>
                                    <option value="year">Publication Year</option>
                                </select>
                                <svg className="absolute right-0 pointer-events-none text-[#041729] group-hover:opacity-70 transition-opacity" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
                            </div>
                        </div>
                    </div>

                    {/* Section - Library Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 w-full">
                        {/* Book Card 1 */}
                        <div className="flex flex-col gap-4 col-span-1 hover:scale-105 transition-all duration-300 cursor-pointer">
                            <div className="w-full aspect-[2/3] bg-gray-200 rounded-sm overflow-hidden shadow-sm">
                                <img src="/lib-book1.png" className="w-full h-full object-cover" alt="The Philosophy of Silence" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <p className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase">CLASSIC LITERATURE</p>
                                <h3 className="text-[#041729] font-noto text-[20px] leading-tight mt-1">The Philosophy of Silence</h3>
                                <p className="text-[#5F5E5E] text-[12px] mt-1">Marcus Aurelius</p>
                            </div>
                        </div>

                        {/* Book Card 2 */}
                        <div className="flex flex-col gap-4 col-span-1 hover:scale-105 transition-all duration-300 cursor-pointer">
                            <div className="w-full aspect-[2/3] bg-gray-200 rounded-sm overflow-hidden shadow-sm">
                                <img src="/lib-book2.png" className="w-full h-full object-cover" alt="A Room of One's Own" />
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
                                <img src="/lib-featured.png" className="w-full h-full object-cover" alt="Beyond the Shadow of Doubt" />
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
                        <div className="flex flex-col gap-4 col-span-1 hover:scale-105 transition-all duration-300 cursor-pointer">
                            <div className="w-full aspect-[2/3] bg-gray-200 rounded-sm overflow-hidden shadow-sm">
                                <img src="/lib-book3.png" className="w-full h-full object-cover" alt="The Art of Worldmaking" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <p className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase">PHILOSOPHY</p>
                                <h3 className="text-[#041729] font-noto text-[20px] leading-tight mt-1">The Art of Worldmaking</h3>
                                <p className="text-[#5F5E5E] text-[12px] mt-1">Nelson Goodman</p>
                            </div>
                        </div>

                        {/* Book Card 4 */}
                        <div className="flex flex-col gap-4 col-span-1 hover:scale-105 transition-all duration-300 cursor-pointer">
                            <div className="w-full aspect-[2/3] bg-gray-200 rounded-sm overflow-hidden shadow-sm">
                                <img src="/lib-book4.png" className="w-full h-full object-cover" alt="Great Expectations" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <p className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase">VICTORIAN ERA</p>
                                <h3 className="text-[#041729] font-noto text-[20px] leading-tight mt-1">Great Expectations</h3>
                                <p className="text-[#5F5E5E] text-[12px] mt-1">Charles Dickens</p>
                            </div>
                        </div>

                        {/* Book Card 5 */}
                        <div className="flex flex-col gap-4 col-span-1 hover:scale-105 transition-all duration-300 cursor-pointer">
                            <div className="w-full aspect-[2/3] bg-gray-200 rounded-sm overflow-hidden shadow-sm">
                                <img src="/lib-book5.png" className="w-full h-full object-cover" alt="Notes on the Archipelago" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <p className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase">ANTHOLOGY</p>
                                <h3 className="text-[#041729] font-noto text-[20px] leading-tight mt-1">Notes on the Archipelago</h3>
                                <p className="text-[#5F5E5E] text-[12px] mt-1">Various Authors</p>
                            </div>
                        </div>

                        {/* Book Card 6 */}
                        <div className="flex flex-col gap-4 col-span-1 hover:scale-105 transition-all duration-300 cursor-pointer">
                            <div className="w-full aspect-[2/3] bg-gray-200 rounded-sm overflow-hidden shadow-sm">
                                <img src="/lib-book6.png" className="w-full h-full object-cover" alt="The Lost Manuscripts" />
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

            {/* Mobile View */}
            <div className="flex md:hidden w-full flex-col px-6 pt-24 pb-32 gap-6 bg-[#FDF9EF] items-center">
                {/* Header Section */}
                <div className="flex flex-col gap-2">
                    <h1 className="text-[#041729] font-noto text-4xl font-normal tracking-[-1px]">The Library</h1>
                    <p className="text-[#5F5E5E] text-lg leading-relaxed">
                        A curated selection of defining works, texts, and philosophical treaties.
                    </p>
                </div>

                {/* Filters (Scrollable Row) */}
                <div className="flex w-full overflow-x-auto gap-3 py-2 no-scrollbar -mx-6 px-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden snap-x snap-mandatory">
                    {genres.map((genre) => (
                        <button
                            key={genre}
                            onClick={() => setActiveGenre(genre)}
                            className={`shrink-0 snap-center rounded-sm px-6 py-3 text-[10px] tracking-[1.5px] font-bold uppercase transition-colors ${activeGenre === genre ? "bg-[#041729] text-[#FDF9EF]" : "bg-[#F7F3E9] text-[#5F5E5E]"}`}
                        >
                            {genre}
                        </button>
                    ))}
                </div>

                {/* Era Selection & Sort */}
                <div className="flex justify-between items-center py-2 mb-4">
                    <div className="flex items-center gap-2 text-[#041729] text-sm uppercase tracking-[1.4px] font-semibold">
                        ERA:
                        <select className="bg-transparent border-none outline-none text-[#041729] text-sm uppercase tracking-[1.4px] font-semibold">
                            <option value="enlightenment">ENLIGHTENMENT</option>
                            <option value="romanticism" >Romanticism</option>
                            <option value="victorian-era">Victorian Era</option>
                            <option value="anthology">Anthology</option>
                            <option value="archival-recovery">Archival Recovery</option>
                        </select>
                    </div>
                </div>

                {/* Gallery Grid */}
                <div className="flex flex-col gap-12">
                    {/* Featured Work */}
                    <div className="flex flex-col bg-white shadow-[0_12px_32px_rgba(28,28,22,0.06)] rounded-sm overflow-hidden relative">
                        <div className="bg-[#F7F3E9] py-8 px-6 flex justify-center items-center">
                            <div className="w-48 aspect-[3/4] shadow-md rounded-sm overflow-hidden">
                                <img src="/lib-mobile-book1.png" className="w-full h-full object-cover" alt="Meditations on First Philosophy" />
                            </div>
                        </div>
                        <div className="flex flex-col p-6 gap-4 relative">
                            {/* Progress Rail (decorative) */}
                            <div className="absolute left-0 top-0 w-1 h-full bg-[#D2E4FC] opacity-50"></div>

                            <div className="flex justify-between items-center">
                                <span className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase">PHILOSOPHY</span>
                                <svg width="8" height="10" viewBox="0 0 8 10" fill="none"><path d="M0 0L8 5L0 10V0Z" fill="#39270F" /></svg>
                            </div>
                            <h3 className="text-[#041729] font-noto text-2xl leading-tight">Meditations on First<br />Philosophy</h3>
                            <p className="text-[#5F5E5E] text-sm">René Descartes</p>
                            <p className="text-[#43474C] text-sm leading-relaxed mt-2">
                                In which the existence of God and the immortality of the soul are demonstrated. A foundational text of Western philosophy.
                            </p>
                        </div>
                    </div>

                    {/* List Item 1 */}
                    <div className="flex items-center gap-6">
                        <div className="w-24 h-36 bg-[#F7F3E9] p-2 shrink-0 rounded-sm">
                            <img src="/lib-mobile-book2.png" className="w-full h-full object-cover shadow-sm rounded-[2px]" alt="The Brothers Karamazov" />
                        </div>
                        <div className="flex flex-col gap-2">
                            <span className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase">CLASSIC LITERATURE</span>
                            <h3 className="text-[#041729] font-noto text-[18px] leading-[1.3]">The Brothers<br />Karamazov</h3>
                            <p className="text-[#5F5E5E] text-sm">Fyodor Dostoevsky</p>
                            <div className="mt-1 flex items-center gap-2">
                                <div className="w-2 h-2 bg-[#39270F] rounded-full"></div>
                                <span className="text-[#43474C] text-[10px] uppercase font-bold tracking-wider">Community Highlighted</span>
                            </div>
                        </div>
                    </div>

                    {/* List Item 2 */}
                    <div className="flex items-center gap-6">
                        <div className="w-24 h-36 bg-[#F7F3E9] p-2 shrink-0 rounded-sm">
                            <img src="/lib-mobile-book3.png" className="w-full h-full object-cover shadow-sm rounded-[2px]" alt="Leaves of Grass" />
                        </div>
                        <div className="flex flex-col gap-2">
                            <span className="text-[#5F5E5E] text-[10px] font-bold tracking-[1.5px] uppercase">POETRY</span>
                            <h3 className="text-[#041729] font-noto text-[18px] leading-[1.3]">Leaves of Grass</h3>
                            <p className="text-[#5F5E5E] text-sm">Walt Whitman</p>
                            <div className="mt-1 w-16 h-1 bg-[#ECE8DE] rounded-full"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}