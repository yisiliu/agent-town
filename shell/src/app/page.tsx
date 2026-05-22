// Landing — replaced by the real login surface in Task 16.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-medium tracking-tight">agent-town</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        课堂用的临时小镇。把你的 card.md 传上来，AI 会按这份卡片演你。
      </p>
      <p className="text-sm text-neutral-500">
        想私下跟它说几句，去聊天页；想看它跟别人怎么处，等它进镇子就行。
      </p>
      <nav className="mt-4 flex gap-4 text-sm">
        <a href="/upload" className="text-indigo-600 underline">传一份分身</a>
        <a href="/chat" className="text-indigo-600 underline">跟我的分身聊聊</a>
        <a href="/spec" className="text-neutral-500 underline hover:text-neutral-700 dark:hover:text-neutral-300">card.md 怎么写</a>
      </nav>
    </main>
  );
}
