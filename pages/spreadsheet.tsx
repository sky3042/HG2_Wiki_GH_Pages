import * as fs from 'node:fs'
import * as path from 'node:path'

import * as React from 'react'
import { useClickAway, useDebounce, useMedia } from 'react-use'
import { type TableComponents, TableVirtuoso } from 'react-virtuoso'

import { Footer } from '@/components/Footer'
import { NotionPageHeader } from '@/components/NotionPageHeader'
import { PageHead } from '@/components/PageHead'
import * as config from '@/lib/config'

type SheetData = Record<string, any[][]>;

const ITEMS_PER_PAGE = 100;
const MAX_COLUMN_WIDTH = 200;
const MAX_SELECT_ITEMS = 30;
const EMPTY_KEY = '$$EMPTY$$';

// 選択型の絞り込みの候補の並び順（ここに指定した順序が優先されます）
const CUSTOM_SORT_ORDER = [
  '武器',
  '服装',
  '勲章',
  '従魔',
  'キャラ',
  'スキン',
  '図鑑なし'
];

// 文字列の表示幅を概算
const getTextDisplayLength = (text: string) => {
  let len = 0;
  const str = String(text ?? '');
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if ((code >= 0x30_00 && code <= 0xff_ff) || (code >= 0xff_00 && code <= 0xff_60)) {
      len += 2; // 全角
    } else {
      len += 1; // 半角
    }
  }
  return len;
};

// セルコンポーネント
// 変更点: 内部ステートを削除し、親から開閉状態とトグル関数を受け取るように変更
function DataCell({ content, width, isExpanded, onToggle, colIndex }: { content: any, width: number, isExpanded: boolean, onToggle: () => void, colIndex?: number }) {
  const str = String(content ?? '');
  const lines = str.split(/[\r\n]+/);
  const hasMultiLines = lines.length > 1;
  const firstLine = lines[0] || '';

  // パディングを詰める (8px 10px -> 8px 4px)
  const cellStyle: React.CSSProperties = {
    padding: '8px 4px',
    minWidth: `${width}px`,
    maxWidth: `${MAX_COLUMN_WIDTH}px`,
    cursor: hasMultiLines ? 'pointer' : 'default',
    position: 'relative',
    backgroundColor: isExpanded ? 'var(--custom-bg-expanded)' : 'transparent',
    transition: 'background-color 0.2s'
  };

  if (!hasMultiLines) {
    return (
      <div style={{
        ...cellStyle,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        lineHeight: '1.4',
      }}>
        <HighlightedCellContent content={str} colIndex={colIndex} />
      </div>
    );
  }


  return (
    <div
      onClick={onToggle}
      title="クリックして展開/折りたたみ"
      style={cellStyle}
    >
      {isExpanded ? (
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.4' }}>
          <HighlightedCellContent content={str} colIndex={colIndex} />
          <div style={{ color: 'var(--custom-text-lighter)', fontSize: '10px', marginTop: '4px', textAlign: 'center' }}>
            ▲ 閉じる
          </div>
        </div>
      ) : (
        <div style={{
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '4px' // 隙間も詰める
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <HighlightedCellContent content={firstLine} colIndex={colIndex} />
          </span>
          <span style={{ fontSize: '10px', color: 'var(--custom-text-light)', flexShrink: 0 }}>
            ▼
          </span>
        </div>
      )}
    </div>
  );
}

// 検索語句を強調表示するコンポーネント
function HighlightedText({ text, queries }: { text: string, queries: string[] }) {
  const activeQueries = queries
    .map(q => q?.trim())
    .filter((q): q is string => !!q && q.length > 0);

  if (activeQueries.length === 0) return <>{text}</>;

  // 特殊文字をエスケープして正規表現を作成（長い語句から順にマッチさせる）
  const escapedQueries = [...new Set(activeQueries)]
    .sort((a, b) => b.length - a.length)
    .map(q => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  const regex = new RegExp(`(${escapedQueries.join('|')})`, 'gi');
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) => {
        const isMatch = activeQueries.some(q => q.toLowerCase() === part.toLowerCase());
        return isMatch ? <mark key={i}>{part}</mark> : part;
      })}
    </>
  );
}

// セル内の強調表示ロジックを共通化するためのラッパー
function HighlightedCellContent({ content, colIndex }: { content: string, colIndex?: number }) {
  const ctx = React.useContext(SpreadsheetContext);
  if (!ctx) return <>{content}</>;

  const { globalSearchQuery, columnFilters } = ctx;
  const queries: string[] = [];

  if (globalSearchQuery) queries.push(globalSearchQuery);
  if (colIndex !== undefined) {
    const filter = columnFilters[colIndex];
    if (typeof filter === 'string' && filter) {
      queries.push(filter);
    }
  }

  return <HighlightedText text={content} queries={queries} />;
}


// 複数選択フィルターコンポーネント
function FilterMultiSelect({ options, value, onChange }: { options: string[], value: string[] | undefined, onChange: (val: string[] | undefined) => void }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [coords, setCoords] = React.useState({ top: 0, left: 0, width: 200 });

  const selectedSet = new Set(value);
  const isNoneSelected = value === undefined || value.length === 0;

  useClickAway(menuRef, (e) => {
    if (ref.current && ref.current.contains(e.target as Node)) return;
    setIsOpen(false);
  });

  const toggleOpen = () => {
    if (!isOpen && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      let left = rect.left;
      if (left + 250 > window.innerWidth) {
        left = window.innerWidth - 260;
      }
      setCoords({
        top: rect.bottom,
        left,
        width: Math.max(rect.width, 200)
      });
    }
    setIsOpen(!isOpen);
  };

  const handleCheck = (option: string) => {
    const newSet = new Set(selectedSet);
    if (newSet.has(option)) {
      newSet.delete(option);
    } else {
      newSet.add(option);
    }

    onChange(Array.from(newSet));
  };

  const handleSelectAll = () => onChange(options);
  const handleClear = () => onChange([]);

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <div
        onClick={toggleOpen}
        style={{
          width: '100%',
          padding: '6px 4px', // パディング調整
          fontSize: '12px',
          border: '1px solid var(--custom-border-dark)',
          borderRadius: '4px',
          boxSizing: 'border-box',
          backgroundColor: 'var(--custom-bg)',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: isNoneSelected ? 'var(--custom-text-muted)' : 'var(--custom-blue)',
          fontWeight: isNoneSelected ? 'normal' : 'bold'
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isNoneSelected ? '指定なし' : `${selectedSet.size}件`}
        </span>
        <span style={{ fontSize: '10px' }}>▼</span>
      </div>

      {isOpen && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            width: 250,
            maxHeight: 300,
            overflowY: 'auto',
            backgroundColor: 'var(--custom-bg)',
            border: '1px solid var(--custom-border-darker)',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 99_999,
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid var(--custom-border)', paddingBottom: '4px' }}>
            <button onClick={handleSelectAll} style={{ fontSize: '11px', padding: '2px 6px', cursor: 'pointer', border: 'none', background: 'none', color: 'var(--custom-blue)' }}>全選択</button>
            <button onClick={handleClear} style={{ fontSize: '11px', padding: '2px 6px', cursor: 'pointer', border: 'none', background: 'none', color: 'var(--custom-danger-text)' }}>解除</button>
          </div>
          {options.map(option => (
            <label key={option} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', padding: '2px 0' }}>
              <input
                type="checkbox"
                checked={selectedSet.has(option)}
                onChange={() => handleCheck(option)}
              />
              {option === EMPTY_KEY ? <span style={{ color: 'var(--custom-text-light)' }}>(空白)</span> : option}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}


// --- Context ---
interface SpreadsheetContextType {
  header: any[];
  columnWidths: number[];
  columnOrder: number[]; // 表示順序（データのインデックスの配列）
  sortConfig: { colIndex: number, direction: 'asc' | 'desc' } | null;
  showFilter: boolean;
  filterInputs: Record<number, string | string[]>; // 即時反映用ステート
  uniqueValuesMap: Record<number, string[]>;
  globalSearchQuery: string;
  columnFilters: Record<number, string | string[]>;
  handleSort: (i: number) => void;
  handleColumnFilterChange: (i: number, val: string | string[] | undefined) => void;
  getStickyStyle: (colIndex: number, visualIndex: number, bgColor: string, rowType: 'header' | 'filter' | 'data') => React.CSSProperties;
}


const SpreadsheetContext = React.createContext<SpreadsheetContextType | null>(null);

// --- Header Content ---
function SpreadsheetHeaderContent() {
  const ctx = React.useContext(SpreadsheetContext);
  if (!ctx) return null;

  const { header, columnWidths, columnOrder, sortConfig, showFilter, filterInputs, uniqueValuesMap, handleSort, handleColumnFilterChange, getStickyStyle } = ctx;

  return (
    <>
      <tr style={{ background: 'var(--custom-bg-hover)' }}>
        {columnOrder.map((colIndex, visualIndex) => {
          const col = header[colIndex];
          return (
            <th
              key={colIndex}
              onClick={() => handleSort(colIndex)}
              style={{
                padding: '0',
                color: 'var(--custom-text)',
                cursor: 'pointer',
                userSelect: 'none',
                ...getStickyStyle(colIndex, visualIndex, sortConfig?.colIndex === colIndex ? 'var(--custom-bg-active)' : 'var(--custom-bg-hover)', 'header')
              }}
            >
              <div style={{
                padding: '8px 4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '4px',
                width: `${columnWidths[colIndex]}px`,
                maxWidth: `${MAX_COLUMN_WIDTH}px`,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: '1.3',
                textAlign: 'left'
              }}>
                {col}
                <span style={{ fontSize: '10px', color: 'var(--custom-text-light)', flexShrink: 0 }}>
                  {sortConfig?.colIndex === colIndex ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '⇅'}
                </span>
              </div>
            </th>
          );
        })}
      </tr>
      {showFilter && (
        <tr style={{ background: 'var(--custom-bg-alt)' }}>
          {columnOrder.map((colIndex, visualIndex) => {
            const uniqueValues = uniqueValuesMap[colIndex] || [];
            const isSelectMode = uniqueValues.length <= MAX_SELECT_ITEMS && uniqueValues.length > 0;

            return (
              <td key={colIndex} style={{
                padding: '5px',
                ...getStickyStyle(colIndex, visualIndex, 'var(--custom-bg-alt)', 'filter')
              }}>
                {isSelectMode ? (
                  <FilterMultiSelect
                    options={uniqueValues}
                    value={filterInputs[colIndex] as string[] | undefined}
                    onChange={(val) => handleColumnFilterChange(colIndex, val)}
                  />
                ) : (
                  <input
                    type="text"
                    placeholder="絞り込み..."
                    value={(filterInputs[colIndex] as string) || ''}
                    onChange={(e) => handleColumnFilterChange(colIndex, e.target.value)}
                    style={{ width: '100%', padding: '6px', fontSize: '12px', border: '1px solid var(--custom-border-dark)', borderRadius: '4px', boxSizing: 'border-box', background: 'var(--custom-bg)', color: 'var(--custom-text)' }}
                  />
                )}
              </td>
            );
          })}
        </tr>
      )}
    </>
  );
}

// 変更点: 行ごとのレンダリングロジックをコンポーネントとして抽出
// これにより行単位で開閉状態(isRowExpanded)を管理できるようになります
function RowContent({ index, row }: { index: number, row: any[] }) {
  const ctx = React.useContext(SpreadsheetContext);
  const [isRowExpanded, setIsRowExpanded] = React.useState(false);

  if (!ctx) return null;
  const { header, columnWidths, columnOrder, getStickyStyle } = ctx;

  const toggleRow = () => setIsRowExpanded(prev => !prev);

  return (
    <>
      {columnOrder.map((cellIndex, visualIndex) => {
        const cell = row[cellIndex];
        const colName = header[cellIndex];
        const isImageColumn = colName === '画像';

        return (
          <td key={cellIndex} style={{
            padding: '0',
            verticalAlign: 'top',
            ...getStickyStyle(cellIndex, visualIndex, index % 2 === 0 ? 'var(--custom-bg)' : 'var(--custom-bg-alt)', 'data')
          }}>
            {isImageColumn ? (
              <div style={{
                padding: '8px 4px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: '40px'
              }}>
                {cell ? (
                  <img
                    src={`/images/${String(cell).padStart(3, '0')}.png`}
                    alt={String(cell)}
                    style={{
                      width: '50px',
                      height: 'auto',
                      objectFit: 'contain',
                      display: 'block'
                    }}
                    loading="lazy"
                  />
                ) : null}
              </div>
            ) : (
              <DataCell
                content={cell}
                width={columnWidths[cellIndex] || 60}
                isExpanded={isRowExpanded}
                onToggle={toggleRow}
                colIndex={cellIndex}
              />

            )}
          </td>
        );
      })}
    </>
  );
}

export async function getStaticProps() {
  try {
    const jsonPath = path.join(process.cwd(), 'data', 'spreadsheet.json')
    if (!fs.existsSync(jsonPath)) {
      return { props: { sheets: {} }, revalidate: 10 }
    }
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    return {
      props: { sheets: data }
    }
  } catch (err) {
    console.error('Failed to load spreadsheet data', err)
    return { props: { sheets: {} } }
  }
}

export default function SpreadsheetPage({ sheets }: { sheets: SheetData }) {
  const sheetNames = Object.keys(sheets);

  const [activeTab, setActiveTab] = React.useState(sheetNames[0] || '');
  const [globalSearchInput, setGlobalSearchInput] = React.useState(''); // 入力用
  const [globalSearchQuery, setGlobalSearchQuery] = React.useState(''); // 実行用

  const [filterInputs, setFilterInputs] = React.useState<Record<number, string | string[]>>({}); // 入力用
  const [columnFilters, setColumnFilters] = React.useState<Record<number, string | string[]>>({}); // 実行用

  const [sortConfig, setSortConfig] = React.useState<{ colIndex: number, direction: 'asc' | 'desc' } | null>(null);
  const showFilter = true; // 常に絞り込みを表示

  const isMobile = useMedia('(max-width: 768px)', false);

  const searchInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useDebounce(
    () => {
      setGlobalSearchQuery(globalSearchInput);
      setColumnFilters(filterInputs);
    },
    500, // 500msの遅延
    [globalSearchInput, filterInputs]
  );

  const rawData = sheets[activeTab] || [];
  const header = rawData[0] || [];
  const bodyRows = rawData.slice(1);

  // ★列幅の計算ロジック
  const columnWidths = React.useMemo(() => {
    const widths: number[] = new Array(header.length).fill(0);

    for (const row of [header, ...bodyRows]) {
      for (const [colIndex, cell] of row.entries()) {
        if (!cell) continue;
        if (colIndex >= widths.length) continue;

        const str = String(cell);
        let firstLine = str.split(/[\r\n]+/)[0] ?? '';

        if (firstLine.length > 40) {
          const spaceSplit = firstLine.split(/[\s\u3000]/);
          if (spaceSplit.length > 1 && spaceSplit[0]!.length > 0) {
            firstLine = spaceSplit[0]!;
          }
        }

        const estimatedWidth = (getTextDisplayLength(firstLine) * 8) + 26;

        const currentWidth = widths[colIndex] || 0;
        if (estimatedWidth > currentWidth) {
          widths[colIndex] = Math.min(estimatedWidth, MAX_COLUMN_WIDTH);
        }
      }
    }

    // 「画像」列の幅を確保 (最低80px)
    for (const [i, colName] of header.entries()) {
      if (colName === '画像') {
        if ((widths[i] || 0) < 80) {
          widths[i] = 80;
        }
      }
    }

    return widths;
  }, [header, bodyRows]);

  // ★列の表示順序を計算（画像 -> 名前 -> その他）
  const columnOrder = React.useMemo(() => {
    const order: number[] = [];
    let imageIndex = -1;
    let nameIndex = -1;

    header.forEach((col: any, i: number) => {
      if (col === '画像') imageIndex = i;
      else if (col === '名前') nameIndex = i;
    });

    if (imageIndex !== -1) order.push(imageIndex);
    if (nameIndex !== -1) order.push(nameIndex);

    header.forEach((_: any, i: number) => {
      if (i !== imageIndex && i !== nameIndex) {
        order.push(i);
      }
    });

    return order;
  }, [header]);

  // 1. ユニーク値の抽出
  const uniqueValuesMap = React.useMemo(() => {
    const map: Record<number, string[]> = {};
    if (bodyRows.length === 0) return map;

    for (const [colIndex, _] of header.entries()) {
      const values = new Set<string>();
      for (const row of bodyRows) {
        const cell = row[colIndex];
        if (cell === null || cell === undefined || String(cell).trim() === '') {
          values.add(EMPTY_KEY);
        } else {
          values.add(String(cell));
        }
      }
      map[colIndex] = Array.from(values).sort((a, b) => {
        if (a === EMPTY_KEY) return -1;
        if (b === EMPTY_KEY) return 1;

        const indexA = CUSTOM_SORT_ORDER.indexOf(a);
        const indexB = CUSTOM_SORT_ORDER.indexOf(b);

        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;

        return a.localeCompare(b, 'ja');
      });
    }
    return map;
  }, [header, bodyRows]);

  const cleanRows = React.useMemo(() => {
    return bodyRows.filter(row => {
      return row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '');
    });
  }, [bodyRows]);

  const filteredRows = React.useMemo(() => {
    return cleanRows.filter(row => {
      if (globalSearchQuery) {
        const lowerQuery = globalSearchQuery.toLowerCase();
        const matchGlobal = row.some((cell: any) => String(cell ?? '').toLowerCase().includes(lowerQuery));
        if (!matchGlobal) return false;
      }

      for (const [colIndexStr, filterValue] of Object.entries(columnFilters)) {
        if (!filterValue || (Array.isArray(filterValue) && filterValue.length === 0)) continue;

        const colIndex = Number(colIndexStr);
        const rawCellValue = String(row[colIndex] ?? '');
        const cellValue = (rawCellValue.trim() === '') ? EMPTY_KEY : rawCellValue;

        if (Array.isArray(filterValue)) {
          if (!filterValue.includes(cellValue)) {
            return false;
          }
        } else {
          if (!rawCellValue.toLowerCase().includes(filterValue.toLowerCase())) {
            return false;
          }
        }
      }
      return true;
    });
  }, [cleanRows, globalSearchQuery, columnFilters]);

  const sortedRows = React.useMemo(() => {
    const currentSort = sortConfig;
    if (!currentSort) return filteredRows;

    const { colIndex, direction } = currentSort;

    if (colIndex === -1) {
      if (direction === 'desc') {
        return [...filteredRows].reverse();
      }
      return filteredRows;
    }

    return [...filteredRows].sort((a, b) => {
      const cellA = a[colIndex];
      const cellB = b[colIndex];
      const numA = Number(cellA);
      const numB = Number(cellB);

      if (!isNaN(numA) && !isNaN(numB) && cellA !== '' && cellB !== '') {
        return direction === 'asc' ? numA - numB : numB - numA;
      } else {
        const strA = String(cellA ?? '');
        const strB = String(cellB ?? '');
        return direction === 'asc'
          ? strA.localeCompare(strB, 'ja')
          : strB.localeCompare(strA, 'ja');
      }
    });
  }, [filteredRows, sortConfig]);

  const handleTabChange = (name: string) => {
    setActiveTab(name);
    setGlobalSearchInput('');
    setGlobalSearchQuery('');
    setFilterInputs({});
    setColumnFilters({});
    setSortConfig(null);
  };

  const handleGlobalSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setGlobalSearchInput(e.target.value);
  };

  const handleColumnFilterChange = (colIndex: number, value: string | string[] | undefined) => {
    setFilterInputs(prev => {
      if (value === undefined) {
        const next = { ...prev };
        delete next[colIndex];
        return next;
      }
      return { ...prev, [colIndex]: value };
    });
  };

  const handleSort = (colIndex: number) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.colIndex === colIndex && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ colIndex, direction });
  };

  const resetSort = () => setSortConfig(null);
  const reverseDefaultSort = () => setSortConfig({ colIndex: -1, direction: 'desc' });

  // ★Stickyスタイルの生成（2列固定対応）
  const getStickyStyle = (colIndex: number, visualIndex: number, bgColor: string, rowType: 'header' | 'filter' | 'data'): React.CSSProperties => {
    const style: React.CSSProperties = {
      backgroundColor: bgColor,
      borderBottom: rowType === 'header' || rowType === 'filter' ? '1px solid var(--custom-border-dark)' : '1px solid var(--custom-border-light)',
      borderRight: '1px solid var(--custom-border)',
      padding: 0,
      verticalAlign: 'top',
      zIndex: 1
    };

    // 画像列(0番目) と 名前列(1番目) を固定
    if (!isMobile && (visualIndex === 0 || visualIndex === 1)) {
      style.position = 'sticky';
      if (visualIndex === 0) {
        style.left = 0;
        style.zIndex = 100;
      } else {
        // 1番目の列（画像）の幅分ずらす
        const firstColIndex = columnOrder[0];
        const firstColWidth = firstColIndex !== undefined ? (columnWidths[firstColIndex] || 0) : 0;
        style.left = `${firstColWidth}px`;
        style.zIndex = 100;
      }
      style.boxShadow = visualIndex === 1 ? '2px 0 5px -2px rgba(0,0,0,0.2)' : 'none';
    }

    if (rowType === 'header') {
      style.position = 'sticky';
      style.top = 0;
    }

    // z-indexの調整: Header > Filter > Data, 固定列 > 通常列
    const isStickyCol = !isMobile && (visualIndex === 0 || visualIndex === 1);

    if (rowType === 'header') {
      style.zIndex = isStickyCol ? 1000 : 900;
    } else if (rowType === 'filter') {
      style.zIndex = isStickyCol ? 800 : 700;
    } else {
      style.zIndex = isStickyCol ? 500 : 1;
    }

    return style;
  };

  const contextValue = React.useMemo(() => ({
    header,
    columnWidths,
    columnOrder,
    sortConfig,
    showFilter,
    filterInputs, // ★入力中のステートをコンテキストで渡す
    uniqueValuesMap,
    globalSearchQuery,
    columnFilters,
    handleSort,
    handleColumnFilterChange,
    getStickyStyle
  }), [header, columnWidths, columnOrder, sortConfig, showFilter, filterInputs, uniqueValuesMap, isMobile, globalSearchQuery, columnFilters]);


  const fixedHeaderContent = React.useCallback(() => <SpreadsheetHeaderContent />, []);

  const VirtuosoTableComponents: TableComponents<any[]> = React.useMemo(() => ({
    TableHead: React.forwardRef((props, ref) => (
      <thead {...props} ref={ref} style={{ ...props.style, zIndex: 2000, position: 'sticky', top: 0 }} />
    )),
    TableBody: React.forwardRef((props, ref) => (
      <tbody {...props} ref={ref} />
    )),
  }), []);

  return (
    <>
      <PageHead site={config.site} title="データ一覧" description="スプレッドシートデータ" />
      <NotionPageHeader block={null} />

      <main style={{ maxWidth: '100%', margin: '0 auto', padding: '20px' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '20px', maxWidth: '1200px', marginInline: 'auto' }}>データ一覧</h1>

        <div style={{ maxWidth: '1200px', margin: '0 auto 20px', display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '5px' }}>
          {sheetNames.map((name) => (
            <button
              key={name}
              onClick={() => handleTabChange(name)}
              style={{
                padding: '8px 16px',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                backgroundColor: activeTab === name ? 'var(--custom-text)' : 'var(--custom-border)',
                color: activeTab === name ? 'var(--custom-bg)' : 'var(--custom-text)',
                fontWeight: 'bold',
                whiteSpace: 'nowrap'
              }}
            >
              {name}
            </button>
          ))}
        </div>

        <div style={{ maxWidth: '1200px', margin: '0 auto 15px', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="全体から検索..."
            value={globalSearchInput}
            onChange={handleGlobalSearch}
            style={{
              flex: '1',
              minWidth: '200px',
              padding: '10px',
              fontSize: '16px',
              border: '1px solid var(--custom-border-darker)',
              borderRadius: '5px',
              backgroundColor: 'var(--custom-bg)',
              color: 'var(--custom-text)'
            }}
          />
          {sortConfig ? (
            <button onClick={resetSort} style={resetBtnStyle}>× 標準に戻す</button>
          ) : (
            <button onClick={reverseDefaultSort} style={controlBtnStyle(false)}>⇅ 逆順にする</button>
          )}
        </div>

        <div style={{ maxWidth: '1200px', margin: '0 auto 10px', fontSize: '14px', color: 'var(--custom-text-muted)' }}>
          {sortedRows.length === 0 ? '該当なし' : `全 ${sortedRows.length} 件を表示`}
        </div>

        <div style={{ height: '80vh', border: '1px solid var(--custom-border)', borderRadius: '8px' }}>
          <SpreadsheetContext.Provider value={contextValue}>
            <TableVirtuoso
              data={sortedRows}
              components={VirtuosoTableComponents}
              fixedHeaderContent={fixedHeaderContent}
              itemContent={(index, row: any[]) => (
                <RowContent index={index} row={row} />
              )}
            />
          </SpreadsheetContext.Provider>
        </div>
      </main>
      <Footer />
    </>
  )
}

const controlBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '10px 15px',
  backgroundColor: active ? 'var(--custom-btn-bg-active)' : 'var(--custom-border-light)',
  color: 'var(--custom-text)',
  border: '1px solid var(--custom-border-darker)',
  borderRadius: '5px',
  cursor: 'pointer',
  fontWeight: 'bold',
  whiteSpace: 'nowrap',
  display: 'flex',
  alignItems: 'center',
  gap: '5px'
});

const resetBtnStyle: React.CSSProperties = {
  padding: '10px 15px',
  backgroundColor: '#f44336',
  color: 'white',
  border: 'none',
  borderRadius: '5px',
  cursor: 'pointer',
  fontWeight: 'bold',
  whiteSpace: 'nowrap'
};