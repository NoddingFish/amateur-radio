"""从分类 JSON 生成离线速记数据和 Markdown；在项目根目录运行。"""

import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
guide = json.loads((root / 'A类题库_知识分类.json').read_text(encoding='utf-8'))
bank = json.loads((root / 'A类题库.json').read_text(encoding='utf-8'))['questions']
seen = []
for group in guide['groups']:
    numbers = group['question_numbers']
    assert group['question_ids'] == [bank[n - 1]['id'] for n in numbers], group['id']
    assert group['topic_id'] in {topic['id'] for topic in guide['topics']}
    seen.extend(numbers)
assert len(seen) == len(set(seen)) == len(bank)
assert sorted(seen) == list(range(1, len(bank) + 1))
for topic in guide['topics']:
    groups = [group for group in guide['groups'] if group['topic_id'] == topic['id']]
    assert topic['group_ids'] == [group['id'] for group in groups]
    assert topic['question_count'] == sum(len(group['question_numbers']) for group in groups)
assert sorted(group for day in guide['plan'][:11] for group in day['group_ids']) == sorted(group['id'] for group in guide['groups'])

(root / 'study-data.js').write_text(
    '// 自动生成；编辑 A类题库_知识分类.json 后运行 scripts/build-study.py。\nwindow.STUDY_GUIDE = '
    + json.dumps(guide, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')


def ranges(numbers):
    result = []
    start = end = numbers[0]
    for number in numbers[1:]:
        if number == end + 1:
            end = number
        else:
            result.append(str(start) if start == end else f'{start}–{end}')
            start = end = number
    result.append(str(start) if start == end else f'{start}–{end}')
    return '、'.join(result)


lines = [
    '# A 类题库分类速记与 14 天复习路线', '',
    '基于当前 CRAC 2025 年版 A 类题库：683 题 → 13 个主题 → 70 个记忆组。题号与答题网站的 1–683 一致，每道题恰好归入一个主记忆组。主题题量不是考试抽题权重。', '',
    '## 先按这个方法学', '',
    '官方 A 类标准：40 题（32 单选＋8 多选），40 分钟，答对 30 题合格；多选须全部一致。', '',
    *[f'{i}. {item}' for i, item in enumerate(guide['learning_method'], 1)], '',
    '## 分类总览', '', '| 主题 | 题数 | 记忆方法 |', '| --- | ---: | --- |',
    *[f"| {topic['title']} | {topic['question_count']} | {topic['method']} |" for topic in guide['topics']], '',
    '## 14 天，每天约 1 小时', '', '| 天 | 任务 | 新题量 | 要点 |', '| --- | --- | ---: | --- |',
    *[f"| {day['day']} | {day['title']} | {day['question_count'] or '混合自测'} | {day['task']} |" for day in guide['plan']], '',
    '## 考前对照表', '',
]
for table in guide['quick_tables']:
    lines += [f"### {table['title']}", '', '| ' + ' | '.join(table['headers']) + ' |', '| ' + ' | '.join(['---'] * len(table['headers'])) + ' |']
    lines += ['| ' + ' | '.join(row) + ' |' for row in table['rows']]
    lines += ['', table['note'], '']
lines += ['## 逐组核心知识', '']
for topic in guide['topics']:
    lines += [f"### {topic['title']}（{topic['question_count']} 题）", '', topic['summary'], '']
    for group in [g for g in guide['groups'] if g['topic_id'] == topic['id']]:
        lines += [f"#### {group['id']} · {group['title']}", '',
            f"**先自测：**{group['recall_question']}", '', f"**记忆线索：**{group['mnemonic']}", '',
            *['- ' + rule for rule in group['rules']], '', f"**易错：**{group['pitfall']}", '',
            f"**核对：**{group['recall_answer']}", '', f"对应题号：{ranges(group['question_numbers'])}（共 {len(group['question_numbers'])} 题）。", '']
lines += ['## 原题需要单独核对的地方', '']
lines += [f"- 第 {ranges(issue['question_numbers'])} 题：{issue['detail']}" for issue in guide['source_cautions']]
lines += ['', '## 来源', '',
    '- [CRAC 2025 年版题库](https://www.crac.org.cn/?p=1287)',
    '- [新版题库启用公告](https://www.crac.org.cn/?p=1170)',
    '- [官方各类别考核标准](' + guide['metadata']['official_standard_url'] + ')', '',
    '本资料为基于题库整理的个人复习辅助，不代替官方法规或更新通知。原题及判分数据保留；发现的表述疑点已明确标出。', '']
(root / 'A类考试_分类速记.md').write_text('\n'.join(lines), encoding='utf-8')
print(f"校验通过：{len(bank)} 题、{len(guide['topics'])} 主题、{len(guide['groups'])} 记忆组；已生成 study-data.js 与分类速记 Markdown。")
