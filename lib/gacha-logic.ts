// lib/gacha-logic.ts
// 参照実装 (houkai_gakuen_gacha2-main) のコードをそのまま移植

// --- Types ---
export interface GachaItem {
  label: string;
  probability: string;
  count: number;
}

export interface CalculationSettings {
  targetsByLabel: Record<string, number>;
  targetCopiesRequired: number;
  maxPulls: number;
  curveStep: number;
}

export interface DrawItem {
  prob: number;
  isGuarantee: boolean;
  targetName: string | null;
}

export interface GraphData {
  pullCount: number;
  probabilities: number[];
}

export interface ErrorInfo {
  type: 'error' | 'warning' | 'info' | 'success';
  title: string;
  message: string;
  suggestions?: string[];
  details?: string;
}

// --- CSV Parser ---
export function parseCSVData(csvText: string): GachaItem[] {
  const lines = csvText.trim().split('\n');
  const data: GachaItem[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    const columns = line.split(',');
    if (columns.length < 3) continue;

    const label = columns[0]?.trim() ?? '';
    const probability = columns[1]?.trim() ?? '';
    const count = parseInt(columns[2]?.trim() ?? '', 10);

    if (label && probability && !isNaN(count)) {
      data.push({ label, probability, count });
    }
  }

  return data;
}

export function formatCSVData(data: GachaItem[]): string {
  const header = 'ラベル,確率,個数';
  const rows = data.map(item => `${item.label},${item.probability},${item.count}`);
  return [header, ...rows].join('\n');
}

// --- Calculator ---
export class GachaCalculator {
  private drawList: DrawItem[] = [];
  private pityTargets: string[] = [];
  private targetNames: string[] = [];
  private targetMap: Record<string, number> = {};
  private guaranteeDrawList: DrawItem[] = [];
  private targetCopies: number = 1;

  prepareData(data: GachaItem[], settings: CalculationSettings) {
    // Parse probabilities and calculate total
    const parsedData = data.map(item => ({
      ...item,
      parsedProb: parseFloat(item.probability.replace('%', '')) / 100,
      groupProb: 0
    }));

    parsedData.forEach(item => {
      item.groupProb = item.parsedProb * item.count;
    });

    const totalProb = parsedData.reduce((sum, item) => sum + item.groupProb, 0);
    if (totalProb <= 0) {
      throw new Error('有効な確率の合計が0以下です。');
    }

    // Store target copies setting
    this.targetCopies = settings.targetCopiesRequired;

    // Setup target names
    this.targetNames = [];
    for (const [label, num] of Object.entries(settings.targetsByLabel)) {
      for (let i = 0; i < num; i++) {
        this.targetNames.push(`${label}-target-${i + 1}`);
      }
    }

    // Create target map (name -> index)
    this.targetMap = {};
    this.targetNames.forEach((name, index) => {
      this.targetMap[name] = index;
    });

    // Setup draw list
    this.drawList = [];
    const guaranteeLabels = new Set(['★5武器', '★5服装', '★5勲章', '追加枠', 'ピックアップ', 'Wピックアップ']);

    // Add target items
    for (const [label, num] of Object.entries(settings.targetsByLabel)) {
      const labelData = parsedData.find(item => item.label === label);
      if (!labelData) {
        throw new Error(`ターゲットラベル '${label}' が見つかりません。`);
      }
      if (num > labelData.count) {
        throw new Error(`ターゲット数(${num})がラベル'${label}'の総数(${labelData.count})を超えています。`);
      }

      const itemProb = labelData.parsedProb;
      const isGuarantee = guaranteeLabels.has(label);

      for (let i = 0; i < num; i++) {
        const targetName = `${label}-target-${i + 1}`;
        this.drawList.push({
          prob: itemProb / totalProb,
          isGuarantee,
          targetName
        });
      }
    }

    // Add non-target items
    for (const item of parsedData) {
      const numTargets = settings.targetsByLabel[item.label] || 0;
      const remainingCount = item.count - numTargets;

      if (remainingCount > 0) {
        const groupProb = item.parsedProb * remainingCount;
        const isGuarantee = guaranteeLabels.has(item.label);

        this.drawList.push({
          prob: groupProb / totalProb,
          isGuarantee,
          targetName: null
        });
      }
    }

    // Setup pity targets
    const pityLabels = new Set(['追加枠', 'ピックアップ', 'Wピックアップ']);
    this.pityTargets = this.targetNames.filter(name => {
      const label = name.split('-target-')[0];
      return pityLabels.has(label ?? '');
    });

    // Setup guarantee distribution
    const guaranteeOptions = this.drawList.filter(item => item.isGuarantee);
    const guaranteeTotal = guaranteeOptions.reduce((sum, item) => sum + item.prob, 0);

    if (guaranteeTotal > 0) {
      this.guaranteeDrawList = guaranteeOptions.map(opt => ({
        ...opt,
        prob: opt.prob / guaranteeTotal
      }));
    } else {
      this.guaranteeDrawList = [];
    }
  }

  *runDPSimulation(maxPulls: number): Generator<Map<string, number>, void, unknown> {
    const dp = new Map<string, number>();
    const numTargets = this.targetNames.length;
    // Initial state: all targets have 0 copies
    const initialCounts = new Array(numTargets).fill(0).join(',');
    dp.set(`${initialCounts},0,0,0`, 1.0);

    for (let i = 0; i < maxPulls; i++) {
      const dpAfterPull = new Map<string, number>();

      for (const [stateKey, prob] of dp.entries()) {
        if (prob === 0) continue;

        const parts = stateKey.split(',');
        const counts = parts.slice(0, numTargets).map(Number);
        const c10 = parseInt(parts[numTargets] ?? '0');
        const f10 = parseInt(parts[numTargets + 1] ?? '0');
        const c100 = parseInt(parts[numTargets + 2] ?? '0');

        const currentDrawList = (c10 === 9 && f10 === 0) ? this.guaranteeDrawList : this.drawList;

        for (const draw of currentDrawList) {
          const nextCounts = [...counts];

          // If this draw is a target and we haven't reached the copy limit
          if (draw.targetName && this.targetMap[draw.targetName] !== undefined) {
            const targetIdx = this.targetMap[draw.targetName] as number;
            if ((counts[targetIdx] as number) < this.targetCopies) {
              nextCounts[targetIdx] = (counts[targetIdx] as number) + 1;
            }
          }

          const nextC100 = (c100 + 1) % 100;

          let nextC10, nextF10;
          if (c10 === 9 && f10 === 0) {
            nextC10 = 0;
            nextF10 = 0;
          } else {
            const currentF10 = f10 || (draw.isGuarantee ? 1 : 0);
            nextC10 = (c10 + 1) % 10;
            nextF10 = nextC10 === 0 ? 0 : currentF10;
          }

          const nextStateKey = `${nextCounts.join(',')},${nextC10},${nextF10},${nextC100}`;
          dpAfterPull.set(nextStateKey, (dpAfterPull.get(nextStateKey) || 0) + prob * draw.prob);
        }
      }

      // Handle pity system
      const dpAfterPity = new Map<string, number>();
      for (const [stateKey, prob] of dpAfterPull.entries()) {
        const parts = stateKey.split(',');
        const counts = parts.slice(0, numTargets).map(Number);
        const c10 = parseInt(parts[numTargets] ?? '0');
        const f10 = parseInt(parts[numTargets + 1] ?? '0');
        const c100 = parseInt(parts[numTargets + 2] ?? '0');

        if (c100 === 0 && (i + 1) % 100 === 0) {
          // Find first pity target that hasn't reached the copy limit
          const unacquired = this.pityTargets.filter(name =>
            (counts[this.targetMap[name] as number] as number) < this.targetCopies
          );

          if (unacquired.length > 0) {
            const pityCounts = [...counts];
            const pityIdx = this.targetMap[unacquired[0] as string] as number;
            pityCounts[pityIdx] = (pityCounts[pityIdx] as number) + 1;
            const pityStateKey = `${pityCounts.join(',')},${c10},${f10},${c100}`;
            dpAfterPity.set(pityStateKey, (dpAfterPity.get(pityStateKey) || 0) + prob);
          } else {
            dpAfterPity.set(stateKey, (dpAfterPity.get(stateKey) || 0) + prob);
          }
        } else {
          dpAfterPity.set(stateKey, (dpAfterPity.get(stateKey) || 0) + prob);
        }
      }

      dp.clear();
      for (const [key, value] of dpAfterPity.entries()) {
        dp.set(key, value);
      }

      yield dp;
    }
  }

  generateGraphData(maxPulls: number, step: number): GraphData[] {
    const results: GraphData[] = [];
    const numTargets = this.targetNames.length;

    let i = 0;
    for (const dpTable of this.runDPSimulation(maxPulls)) {
      const pullCount = i + 1;

      if (pullCount % step === 0 || pullCount === 1 || pullCount === maxPulls) {
        const probsByCount = new Array(numTargets + 1).fill(0);

        for (const [stateKey, prob] of dpTable.entries()) {
          const parts = stateKey.split(',');
          const counts = parts.slice(0, numTargets).map(Number);
          // Count how many targets have reached the required number of copies
          const achievedCount = counts.filter(c => c >= this.targetCopies).length;
          probsByCount[achievedCount] += prob;
        }

        const cumulativeProbs = new Array(numTargets + 1).fill(0);
        let currentSum = 0;
        for (let k = numTargets; k >= 0; k--) {
          currentSum += probsByCount[k];
          cumulativeProbs[k] = currentSum;
        }

        const probabilities = [];
        for (let n = 1; n <= numTargets; n++) {
          probabilities.push(cumulativeProbs[n]);
        }

        results.push({ pullCount, probabilities });
      }

      i++;
    }

    return results;
  }
}

// --- Error Handler ---
export const GachaErrorHandler = {
  validateCalculationData(data: GachaItem[], settings: CalculationSettings): ErrorInfo | null {
    if (data.length === 0) {
      return {
        type: 'error',
        title: 'データエラー',
        message: 'ガチャデータが設定されていません。',
        suggestions: [
          '計算条件タブでガチャアイテムを追加してください',
          'プリセットから既存のデータを読み込んでください',
          'CSVファイルをインポートしてください'
        ]
      };
    }

    if (Object.keys(settings.targetsByLabel).length === 0) {
      return {
        type: 'error',
        title: '設定エラー',
        message: 'ターゲットが設定されていません。',
        suggestions: [
          '設定タブでターゲットアイテムを追加してください',
          '少なくとも1つのアイテムをターゲットとして設定する必要があります'
        ]
      };
    }

    const totalProb = data.reduce((sum, item) => {
      const prob = parseFloat(item.probability.replace('%', ''));
      return sum + (isNaN(prob) ? 0 : prob * item.count);
    }, 0);

    if (totalProb <= 0) {
      return {
        type: 'error',
        title: '確率エラー',
        message: '有効な確率の合計が0以下です。',
        suggestions: [
          '計算条件タブで各アイテムの確率を正しく設定してください',
          '確率は「1.5%」のような形式で入力してください',
          '個数が0のアイテムは確率に影響しません'
        ]
      };
    }

    const errors: string[] = [];
    const suggestions: string[] = [];

    for (const [label, targetCount] of Object.entries(settings.targetsByLabel)) {
      const labelData = data.find(item => item.label === label);

      if (!labelData) {
        errors.push(`ターゲット「${label}」がデータに存在しません`);
        suggestions.push(`計算条件タブで「${label}」を追加するか、設定からターゲットを削除してください`);
        continue;
      }

      if (targetCount > labelData.count) {
        errors.push(`「${label}」のターゲット数(${targetCount})が総数(${labelData.count})を超えています`);
        suggestions.push(`「${label}」のターゲット数を${labelData.count}以下に設定するか、データの個数を増やしてください`);
        continue;
      }

      if (labelData.count === 0) {
        errors.push(`「${label}」の個数が0に設定されています`);
        suggestions.push(`「${label}」の個数を1以上に設定するか、ターゲットから除外してください`);
        continue;
      }

      const prob = parseFloat(labelData.probability.replace('%', ''));
      if (isNaN(prob) || prob <= 0) {
        errors.push(`「${label}」の確率が無効です`);
        suggestions.push(`「${label}」の確率を正しい形式（例：1.5%）で設定してください`);
      }
    }

    if (errors.length > 0) {
      return {
        type: 'error',
        title: 'ターゲット設定エラー',
        message: errors.join('、'),
        suggestions: [...new Set(suggestions)],
        details: `検証エラー詳細:\n${errors.map((error, index) => `${index + 1}. ${error}`).join('\n')}`
      };
    }

    const warnings: string[] = [];
    const warningSuggestions: string[] = [];

    for (const [label] of Object.entries(settings.targetsByLabel)) {
      const labelData = data.find(item => item.label === label);
      if (labelData) {
        const prob = parseFloat(labelData.probability.replace('%', ''));
        if (prob < 0.001) {
          warnings.push(`「${label}」の確率(${labelData.probability})が非常に低く設定されています`);
          warningSuggestions.push('計算に時間がかかる可能性があります');
        }
      }
    }

    if (settings.maxPulls > 500) {
      warnings.push(`最大ガチャ回数(${settings.maxPulls})が多く設定されています`);
      warningSuggestions.push('計算に時間がかかる可能性があります。500回以下を推奨します');
    }

    if (warnings.length > 0) {
      return {
        type: 'warning',
        title: '設定に関する注意',
        message: warnings.join('、'),
        suggestions: warningSuggestions
      };
    }

    return null;
  },

  createCalculationError(error: unknown): ErrorInfo {
    if (error instanceof Error) {
      if (error.message.includes('ターゲット数') && error.message.includes('総数')) {
        const match = error.message.match(/ターゲット数\((\d+)\)がラベル'([^']+)'の総数\((\d+)\)を超えています/);
        if (match) {
          const [, targetCount, label, totalCount] = match;
          return {
            type: 'error',
            title: 'ターゲット設定エラー',
            message: `「${label}」のターゲット数が設定可能な範囲を超えています。`,
            suggestions: [
              `「${label}」のターゲット数を${totalCount}以下に変更してください`,
              `または、計算条件タブで「${label}」の個数を${targetCount}以上に増やしてください`,
              '設定タブでターゲットを削除することもできます'
            ],
            details: `詳細: ターゲット数(${targetCount}) > 利用可能数(${totalCount})`
          };
        }
      }

      if (error.message.includes('が見つかりません')) {
        const match = error.message.match(/ターゲットラベル '([^']+)' が見つかりません/);
        if (match) {
          const [, label] = match;
          return {
            type: 'error',
            title: 'データ不整合エラー',
            message: `ターゲットに設定された「${label}」がデータに存在しません。`,
            suggestions: [
              `計算条件タブで「${label}」を追加してください`,
              `または、設定タブで「${label}」をターゲットから削除してください`
            ]
          };
        }
      }

      return {
        type: 'error',
        title: '計算エラー',
        message: error.message,
        suggestions: [
          'データと設定を確認してください',
          '問題が解決しない場合は、プリセットを使用してみてください'
        ],
        details: error.stack
      };
    }

    return {
      type: 'error',
      title: '不明なエラー',
      message: '予期しないエラーが発生しました。',
      suggestions: [
        'ページを再読み込みしてみてください',
        'データを確認して再度お試しください'
      ],
      details: String(error)
    };
  }
};