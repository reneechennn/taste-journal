// ============ 味覺手帳 · 自訂下拉選單 ============
// macOS 等平台的瀏覽器會用「系統原生選單」渲染 <select> 彈出視窗，
// 不能套用網頁字體樣式（字永遠小小的）。此元件提供外觀可控的下拉：
// 原生 select 仍然隱藏保留、是資料真相，change 事件照常觸發，
// 所以既有的頁面程式（change 監聽、讀取 .value）完全不用改。

export function initCustomSelects(): void {
  document.querySelectorAll<HTMLSelectElement>('select.field:not([data-tj-select])').forEach((sel) => {
    if (sel.options.length === 0) return
    sel.dataset.tjSelect = 'true'
    enhance(sel)
  })
}

function enhance(sel: HTMLSelectElement): void {
  const wrap = document.createElement('div')
  wrap.className = 'tj-select'
  sel.before(wrap)
  sel.style.display = 'none'
  wrap.append(sel)

  const chevron = () =>
    `<svg class="ic" style="width:15px;height:15px"><use href="#i-chevron"></use></svg>`

  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'tj-select-trigger'
  trigger.setAttribute('aria-haspopup', 'listbox')

  const triggerLabel = document.createElement('span')
  trigger.append(triggerLabel)

  const list = document.createElement('div')
  list.className = 'tj-select-list'
  list.setAttribute('role', 'listbox')

  const optionEls: HTMLElement[] = sel.options.length
    ? [...sel.options].map((o, i) => {
        const el = document.createElement('div')
        el.className = 'tj-select-option'
        el.setAttribute('role', 'option')
        el.dataset.idx = String(i)
        el.textContent = o.textContent?.trim() ?? o.value
        list.append(el)
        return el
      })
    : []

  function syncFromSelect() {
    const idx = sel.selectedIndex
    triggerLabel.textContent = sel.options[idx]?.textContent?.trim() ?? sel.value
    optionEls.forEach((el, i) => {
      el.classList.toggle('is-selected', i === idx)
      el.setAttribute('aria-selected', i === idx ? 'true' : 'false')
    })
  }
  syncFromSelect()

  function open() {
    closeAllOther()
    wrap.classList.add('is-open')
    trigger.setAttribute('aria-expanded', 'true')
    // 把選中項目捲到可視範圍
    const cur = optionEls[sel.selectedIndex]
    if (cur) requestAnimationFrame(() => cur.scrollIntoView({ block: 'nearest' }))
  }
  function close() {
    wrap.classList.remove('is-open')
    trigger.setAttribute('aria-expanded', 'false')
  }
  function closeAllOther() {
    document.querySelectorAll('.tj-select.is-open').forEach((w) => {
      if (w !== wrap) {
        w.classList.remove('is-open')
        const t = w.querySelector('.tj-select-trigger')
        t?.setAttribute('aria-expanded', 'false')
      }
    })
  }
  function isOpen() { return wrap.classList.contains('is-open') }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation()
    void (isOpen() ? close() : open())
  })

  list.addEventListener('click', (e) => {
    const opt = (e.target as HTMLElement).closest('.tj-select-option') as HTMLElement | null
    if (!opt) return
    sel.selectedIndex = Number(opt.dataset.idx)
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    close()
    trigger.focus()
  })

  // 鍵盤操作：Enter/Space 開關、上下選、Esc 關閉
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!isOpen()) { open(); return }
      const delta = e.key === 'ArrowDown' ? 1 : -1
      sel.selectedIndex = Math.min(sel.options.length - 1, Math.max(0, sel.selectedIndex + delta))
      syncFromSelect()
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (isOpen()) { sel.dispatchEvent(new Event('change', { bubbles: true })); close() }
      else { e.preventDefault(); open() }
    } else if (e.key === 'Escape') {
      close()
    }
  })

  // 非本體點擊時關閉（一個共用監聽即可，靠 is-open 檢查）
  document.addEventListener('click', (e) => {
    if (isOpen() && !wrap.contains(e.target as Node)) close()
  })

  // 若其他程式改了 select 的值，也要同步
  sel.addEventListener('change', () => { syncFromSelect(); close() })
}

// 一個共用的「點外面就關」邏輯：每次開啟時別的下拉都會先關閉（見 closeAllOther）
