// Chinese phrase fixes from high-visibility UI audit round 5.
export const ZH_PHRASE_FIXES_ROUND5 = [
  { pattern: /Helix集成开发环境/g, replacement: 'Helix IDE', whenEnIncludes: 'Helix IDE' },
  { pattern: /Helix第一/g, replacement: 'Helix 优先', whenEnIncludes: 'Helix first' },
  { pattern: /Helix移动/g, replacement: 'Helix Mobile', whenEnIncludes: 'Helix Mobile' },
  { pattern: /Helix标志/g, replacement: 'Helix 标志', whenEnIncludes: 'Helix logo' },
  { pattern: /喜欢Helix/g, replacement: '喜欢 Helix', whenEnIncludes: 'Enjoying Helix' },
  { pattern: /认识Helix/g, replacement: '了解 Helix', whenEnIncludes: 'Get to know Helix' },
  { pattern: /支持Helix/g, replacement: '支持 Helix', whenEnIncludes: 'Support Helix' },
  { pattern: /展开Helix/g, replacement: '展开 Helix', whenEnIncludes: 'Expand Helix' },
  { pattern: /来自Helix/g, replacement: '来自 Helix', whenEnIncludes: 'from Helix' },
  {
    pattern: /正在重新启动Helix/g,
    replacement: '正在重启 Helix',
    whenEnIncludes: 'Restarting Helix'
  },
  { pattern: /Helix([\u4e00-\u9fff])/g, replacement: 'Helix $1', whenEnIncludes: 'Helix' },
  { pattern: /Linear([\u4e00-\u9fff])/g, replacement: 'Linear $1', whenEnIncludes: 'Linear' },
  { pattern: /Codex([\u4e00-\u9fff])/g, replacement: 'Codex $1', whenEnIncludes: 'Codex' },
  { pattern: /Claude([\u4e00-\u9fff])/g, replacement: 'Claude $1', whenEnIncludes: 'Claude' },
  { pattern: /Claude代码/g, replacement: 'Claude Code', whenEnIncludes: 'Claude Code' },
  { pattern: /GitHub 和Linear/g, replacement: 'GitHub 和 Linear', whenEnIncludes: 'Linear tasks' },
  { pattern: /托管审阅/g, replacement: '托管评审', whenEnIncludes: 'hosted-review' },
  { pattern: /托管审阅/g, replacement: '托管评审', whenEnIncludes: 'Hosted-review' },
  { pattern: /审阅笔记/g, replacement: '评审笔记', whenEnIncludes: 'review note' },
  { pattern: /审阅任务/g, replacement: '评审任务', whenEnIncludes: 'review task' },
  { pattern: /待审阅/g, replacement: '待评审', whenEnIncludes: 'need review' },
  { pattern: /重新审核/g, replacement: '重新评审', whenEnIncludes: 'Re-review' },
  { pattern: /依赖项审核/g, replacement: '依赖项审计', whenEnIncludes: 'dependency audit' },
  { pattern: /Git AI 作者/g, replacement: 'Git AI Author', whenEnIncludes: 'Git AI Author' },
  { pattern: /基本引用/g, replacement: '基础引用', whenEnIncludes: 'base ref' },
  { pattern: /重新开放PR/g, replacement: '重新打开 PR', whenEnIncludes: 'Reopen PR' },
  { pattern: /重新开放/g, replacement: '重新打开', whenEnIncludes: 'reopen' },
  { pattern: /受限制的钥匙/g, replacement: '受限制的密钥', whenEnIncludes: 'restricted keys' },
  { pattern: /更换钥匙/g, replacement: '更换密钥', whenEnIncludes: 'Replace key' },
  {
    pattern: /根据所看到的内容采取行动/g,
    replacement: '根据所看到的内容执行操作',
    whenEnIncludes: 'act on what they see'
  },
  {
    pattern: /建议下一步行动/g,
    replacement: '建议下一步操作',
    whenEnIncludes: 'suggest next actions'
  },
  {
    pattern: /可操作的问题/g,
    replacement: '需处理的问题',
    whenEnIncludes: 'actionable issues'
  },
  {
    pattern: /显示 Helix 移动按钮/g,
    replacement: '显示 Helix Mobile 按钮',
    whenEnIncludes: 'Show Helix Mobile Button'
  }
]
