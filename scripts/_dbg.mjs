import { readFileSync } from 'node:fs'
import { parse } from 'node-html-parser'
const root = parse(readFileSync(process.argv[2], 'utf8'))
for (const ch of root.querySelectorAll('details.ch')) {
  const title = (ch.querySelector('.tt')?.text ?? '').replace(/\s+/g, ' ').trim()
  console.log('=== ' + title + '  badge=' + (ch.querySelector('.cnt span')?.text.trim()))
  for (const st of ch.querySelectorAll('.st')) {
    const nm = st.querySelector('.nm')
    if (!nm) continue
    const span = nm.querySelector('span')
    const name = nm.childNodes.map(n => n.rawTagName === 'span' ? '' : n.text).join('').replace(/\s+/g,' ').trim()
    console.log('   ' + name + (span ? '   [badge: ' + span.text.replace(/\s+/g,' ').trim() + ' | class=' + JSON.stringify(span.getAttribute('class')) + ']' : ''))
  }
}
