// Landing — replaced by the real login surface in Task 16.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-medium tracking-tight">agent-town · AI 小镇</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        课堂时段限定的 2D AI 小镇 · 学生上传数字分身 · 可选公开。
      </p>
      <nav className="mt-4 flex gap-4 text-sm">
        <a href="/upload" className="text-indigo-600 underline">上传数字分身</a>
        <a href="/chat" className="text-indigo-600 underline">和我的分身聊天</a>
        <a href="/instructor" className="text-indigo-600 underline">教师控制台</a>
      </nav>
    </main>
  );
}
