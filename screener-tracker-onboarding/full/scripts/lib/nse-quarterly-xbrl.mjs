const INDAS_FACTS = {
  revenue: 'RevenueFromOperations',
  materials: 'CostOfMaterialsConsumed',
  stockPurchases: 'PurchasesOfStockInTrade',
  inventoryChange: 'ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade',
  employees: 'EmployeeBenefitExpense',
  otherExpenses: 'OtherExpenses',
  netProfit: 'ProfitLossForPeriod',
};

const BANKING_FACTS = {
  revenue: 'InterestEarned',
  employees: 'EmployeesCost',
  otherExpenses: 'OtherOperatingExpenses',
  provisions: 'ProvisionsOtherThanTaxAndContingencies',
  profitForPeriod: 'ProfitLossForThePeriod',
  associates: 'ShareOfProfitLossOfAssociates',
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function canonicalInteger(value) {
  const normalized = value.trim();
  if (!/^[-+]?\d+(?:\.0+)?$/.test(normalized)) return null;
  return BigInt(normalized.replace(/\.0+$/, '')).toString();
}

export function extractFact(xml, localName, contextRef = 'OneD') {
  const name = escapeRegExp(localName);
  const pattern = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${name}(?=\\s|>)([^>]*)>([^<]*)<\\/(?:[A-Za-z_][\\w.-]*:)?${name}\\s*>`,
    'g',
  );

  for (const match of String(xml).matchAll(pattern)) {
    const attributes = match[1];
    const contextPattern = new RegExp(`(?:^|\\s)contextRef\\s*=\\s*(["'])${escapeRegExp(contextRef)}\\1(?:\\s|$)`);
    if (contextPattern.test(attributes)) return canonicalInteger(match[2]);
  }

  return null;
}

function taxonomyFor(xml) {
  if (/IntegratedFinance_Banking(?:\/|["'])/.test(xml)) return 'banking';
  if (/IntegratedFinance_IndAS(?:\/|["'])/.test(xml)) return 'indas';
  throw new Error('XBRL does not declare a supported quarterly-results taxonomy');
}

function collectFacts(xml, names) {
  return Object.fromEntries(
    Object.entries(names).map(([key, localName]) => [key, extractFact(xml, localName)]),
  );
}

function missingNames(facts, names, keys) {
  return keys
    .filter((key) => facts[key] == null)
    .map((key) => names[key]);
}

function calculate(values, operation) {
  if (values.some((value) => value == null)) return null;
  return operation(values.map((value) => BigInt(value))).toString();
}

function parseIndas(xml) {
  const facts = collectFacts(xml, INDAS_FACTS);
  const ebitdaKeys = ['revenue', 'materials', 'stockPurchases', 'inventoryChange', 'employees', 'otherExpenses'];
  const issues = [
    ...missingNames(facts, INDAS_FACTS, ebitdaKeys),
    ...missingNames(facts, INDAS_FACTS, ['netProfit']),
  ];

  return {
    taxonomy: 'indas',
    revenueInr: facts.revenue,
    calculatedEbitdaInr: calculate(
      ebitdaKeys.map((key) => facts[key]),
      ([revenue, materials, stockPurchases, inventoryChange, employees, otherExpenses]) => (
        revenue - materials - stockPurchases - inventoryChange - employees - otherExpenses
      ),
    ),
    netProfitInr: facts.netProfit,
    componentsInr: {
      revenue_from_operations: facts.revenue,
      cost_of_materials_consumed: facts.materials,
      purchases_of_stock_in_trade: facts.stockPurchases,
      changes_in_inventories: facts.inventoryChange,
      employee_benefit_expense: facts.employees,
      other_expenses: facts.otherExpenses,
    },
    issues: [...new Set(issues)],
  };
}

function parseBanking(xml) {
  const facts = collectFacts(xml, BANKING_FACTS);
  const ebitdaKeys = ['revenue', 'employees', 'otherExpenses', 'provisions'];
  const issues = [
    ...missingNames(facts, BANKING_FACTS, ebitdaKeys),
    ...missingNames(facts, BANKING_FACTS, ['profitForPeriod', 'associates']),
  ];

  return {
    taxonomy: 'banking',
    revenueInr: facts.revenue,
    calculatedEbitdaInr: calculate(
      ebitdaKeys.map((key) => facts[key]),
      ([revenue, employees, otherExpenses, provisions]) => (
        revenue - employees - otherExpenses - provisions
      ),
    ),
    netProfitInr: calculate(
      [facts.profitForPeriod, facts.associates],
      ([profitForPeriod, associates]) => profitForPeriod + associates,
    ),
    componentsInr: {
      interest_earned: facts.revenue,
      employees_cost: facts.employees,
      other_operating_expenses: facts.otherExpenses,
      provisions: facts.provisions,
    },
    issues: [...new Set(issues)],
  };
}

export function parseQuarterlyXbrl(xml) {
  const source = String(xml);
  return taxonomyFor(source) === 'banking' ? parseBanking(source) : parseIndas(source);
}

