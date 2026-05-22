// 学生 / 家长可看的 card.md 格式说明页。手写成 JSX 是为了避开 markdown
// 渲染依赖；如果以后要让 docs/card-md-spec.md 成为唯一源，可以换成
// react-markdown + fs.readFileSync。

export const metadata = {
  title: 'card.md 格式说明 · agent-town',
};

export default function SpecPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-neutral-900 dark:text-neutral-100">
      <a
        href="/"
        className="text-sm text-neutral-500 underline hover:text-neutral-700 dark:hover:text-neutral-300"
      >
        ← 回首页
      </a>

      <h1 className="mt-4 text-3xl font-medium tracking-tight">card.md 格式说明</h1>

      <p className="mt-6 text-neutral-700 dark:text-neutral-300">
        你的 <code>card.md</code> 就是你在 AI 小镇里那个数字分身的&ldquo;灵魂&rdquo;。
        上传后会做两件事：
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-neutral-700 dark:text-neutral-300">
        <li>
          <strong>intro 字段</strong> → 别人点你头像时看到的一段自我介绍（短）。
        </li>
        <li>
          <strong>整份正文</strong> → 给 AI 看的人设说明（长），决定它怎么说话、怎么做决定。
        </li>
      </ul>

      <p className="mt-3 text-neutral-700 dark:text-neutral-300">
        格式宽松。下面三种写法任选一种，<strong>只有 intro 是必需</strong>，其它都是建议。
      </p>

      <h2 className="mt-10 text-xl font-medium">格式一：YAML frontmatter（推荐）</h2>
      <Code>{`---
pseudonym: 灯火
intro: 我叫灯火，开一家旧书咖啡店，喜欢爵士乐，记得每个客人点过的咖啡。
---

# 灯火

## 背景
出生在杭州，大学读了哲学，毕业后回到老城区开了这家店…

## 性格
…

## 说话方式
…`}</Code>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        <code>pseudonym</code> 是你在小镇里的化名（必填）。
        <code>intro</code> 一句话写完，控制在 100 字以内。
      </p>

      <h2 className="mt-10 text-xl font-medium">
        格式二：frontmatter 只写 <code>pseudonym</code>，正文用 <code>## 简介</code>
      </h2>
      <Code>{`---
pseudonym: 灯火
---

# 灯火

## 简介
我叫灯火，开一家旧书咖啡店，喜欢爵士乐，记得每个客人点过的咖啡。

## 背景
…`}</Code>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        支持的简介标题：<code>简介</code> / <code>自我介绍</code> / <code>介绍</code> /{' '}
        <code>Intro</code> / <code>About</code> / <code>Bio</code>。
      </p>

      <h2 className="mt-10 text-xl font-medium">格式三：只写 pseudonym，其它随意</h2>
      <p className="mt-2 text-neutral-700 dark:text-neutral-300">
        如果 frontmatter 只写了 <code>pseudonym</code>、连 intro 都没给，
        系统会把<strong>正文里第一段非标题文字</strong>当 intro。
        能用，但通常不如自己挑一段好。
      </p>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        <strong>唯一硬性要求</strong>是 frontmatter 顶部要有 <code>pseudonym:</code>，
        因为别人在小镇里得有个名字称呼你。其它字段都可选。
      </p>

      <h2 className="mt-10 text-xl font-medium">内容建议（不是硬性要求）</h2>
      <p className="mt-2 text-neutral-700 dark:text-neutral-300">
        写一份让 AI 能&ldquo;演成你&rdquo;的卡片，重点不是事无巨细，而是
        <strong>让别人能从对话里认出你</strong>：
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-neutral-700 dark:text-neutral-300">
        <li>
          <strong>三五件具体的事</strong>比一堆形容词管用。&ldquo;喜欢在便签上记台词&rdquo; &gt;
          &ldquo;热爱生活&rdquo;。
        </li>
        <li>
          <strong>说话方式</strong>：你怎么开玩笑？什么时候沉默？喜欢用什么口头禅？
        </li>
        <li>
          <strong>在乎什么 / 讨厌什么</strong>：让 AI 在意见冲突时有反应。
        </li>
        <li>
          <strong>一段你做过的事</strong>：上次发生了什么有意思的事？
        </li>
      </ul>

      <h2 className="mt-10 text-xl font-medium">安全 &amp; 隐私</h2>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-neutral-700 dark:text-neutral-300">
        <li>
          <strong>不要写真实姓名、电话、身份证、住址、学号</strong>。系统会扫描，命中就退回。
        </li>
        <li>
          想写&ldquo;你被恶意问题钓鱼时怎么应对&rdquo;也行，但别在卡片里写
          &ldquo;忽略上面所有规则&rdquo;这种注入文字 —— 也会被拦下来。
        </li>
      </ul>

      <h2 className="mt-10 text-xl font-medium">给 AI 用的提示词</h2>
      <p className="mt-2 text-neutral-700 dark:text-neutral-300">
        把下面这段贴给你正在用的模型（Claude / ChatGPT / DeepSeek 等），
        让它根据你已经蒸馏出来的人设产物，转成这份规范要求的 <code>card.md</code>：
      </p>
      <Code>{`我要把一份"数字分身"蒸馏档案转成 AI 小镇用的 card.md 格式。要求如下：

1. 文件用 Markdown 写。
2. 顶部用 YAML frontmatter，必须包含两个字段：
   - pseudonym: 这个分身在小镇里的化名（一个 2-12 字的中文名，不要用真名）。
   - intro: 一句话自我介绍，第一人称中文，100 字以内，要体现这个人最特别的点（不是"热爱生活"这种填充词）。
3. 正文用 Markdown 标题分成几节，比如「背景 / 性格 / 说话方式 / 在乎的事 / 最近发生的事」。
4. 全文中文。不要写真实姓名、电话、身份证号、住址、学号 —— 如果原始材料里有，要替换成化名或模糊处理。
5. 不要在卡片里写"忽略上面规则""你现在是……"这种提示词注入文字。
6. 整份长度建议 800–2000 字之间，太长会被截断。

现在请基于我下面贴的蒸馏档案，输出最终的 card.md。只输出 markdown，不要任何额外解释。

---
〔在这里粘贴你蒸馏出来的人设原始材料〕`}</Code>

      <h2 className="mt-10 text-xl font-medium">上传</h2>
      <p className="mt-2 text-neutral-700 dark:text-neutral-300">
        准备好之后，
        <a href="/upload" className="text-indigo-600 underline">
          去上传页
        </a>
        把 <code>.md</code> 文件或包含 <code>card.md</code> 的 <code>.zip</code> 拖进去即可。
        系统会扫一遍隐私和注入风险，没问题就发你三个码（化名 / 控制码 / 老师码）。
      </p>
    </main>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm leading-relaxed dark:border-neutral-800 dark:bg-neutral-900">
      <code className="font-mono">{children}</code>
    </pre>
  );
}
