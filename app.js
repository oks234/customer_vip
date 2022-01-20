const path = require('path');
const fs = require('fs');
const { map, sortBy, some, last } = require('lodash');
const moment = require('moment');
const XLSX = require('XLSX');

const TAG_SPLITTER = ', '
const DIST_PATH = 'results';
const DEFAULT_TIME_FORMAT = "YYYY-MM-DD HH:mm:ss ZZ";

const CUSTOMER_PROPS = {
  EMAIL: 'Email',
  PHONE: 'Phone',
  TOTAL_SPENT: 'Total Spent',
  TOTAL_ORDERS: 'Total Orders',
  TAGS: 'Tags',
  TOTAL_SPENT_IN_DATE_RANGE: 'Total Spent In Date Range',
};
const ORDER_PROPS = {
  NAME: 'Name',
  EMAIL: 'Email',
  FINANCIAL_STATUS: 'Financial Status',
  TOTAL: 'Total',
  DISCOUNT_CODE: 'Discount Code',
  PHONE: 'Phone',
  CREATED_AT: 'Created at',
  REFUNDED_AMOUNT: 'Refunded Amount',
};

const getObjectValues = (object, excepts) => {
  let result = map(Object.getOwnPropertyNames(object), propertyName => object[propertyName]);
  result = result.filter(value => !some(excepts, except => except === value));
  return result;
};

const getConfigs = () => {
  const filepath = path.join(__dirname, 'configs.txt');
  const buffer = fs.readFileSync(filepath);
  const bufferString = buffer.toString();
  const configs = bufferString.split('\n')
    .filter(item => !item.includes('//'))
    .filter(item => item.trim() !== '')
    .map(item => item.split('='))
    .reduce((obj, curr) => {
      const [prop, val] = curr;
      let formattedVal;
      if ([ 'VIP_NAMES', 'VIP_TOTALS', 'VIP_DATES', 'CUSTOMER_PROPS_FILTERS', 'ORDER_PROPS_FILTERS' ].includes(prop)) {
        formattedVal = val.split(',');

        if (prop === 'VIP_TOTALS') {
          formattedVal = formattedVal.map(str => parseInt(str));
        } else if (prop === 'VIP_DATES') {
          formattedVal = formattedVal.map(str => str);
        }
      } else if (prop === 'FILTER_MODIFIED_CUSTOMERS') {
        formattedVal = val.toLowerCase() === 'true';
      } else {
        formattedVal = val;
      }
      obj[prop] = formattedVal;
      return obj;
    }, {});

  return configs;
}

const getJsonDataFromFilename = (filename) => {
  const filepath = path.join(__dirname, filename);
  const workbook = XLSX.readFile(filepath, { type: "array", raw: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const jsonData = XLSX.utils.sheet_to_json(sheet);

  return jsonData;
}

const writeCsv = (filename, jsonData, propsFilters) => {
  let filteredJsonData;
  if (propsFilters && propsFilters.length) {
    filteredJsonData = jsonData.map((data, dataIndex) => propsFilters.reduce((obj, prop) => {
      obj[prop] = data[prop];
      return obj;
    }, {}));
  }
  const distPath = path.join(__dirname, DIST_PATH);
  const filepath = path.join(__dirname, DIST_PATH, filename);
  // const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(filteredJsonData || jsonData);
  const csv = XLSX.utils.sheet_to_csv(worksheet);
  // XLSX.utils.book_append_sheet(workbook, worksheet);
  try {
    fs.accessSync(distPath, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    fs.mkdirSync(distPath);
  } finally {
    fs.writeFileSync(filepath, csv);
    console.log(`${filename}`, jsonData.length);
  }
};

const getCustomerOrdersTotal = (customer, _orders) => {
  const email = customer[CUSTOMER_PROPS.EMAIL];
  const phone = customer[CUSTOMER_PROPS.PHONE];
  const customerOrders = _orders.filter(order => {
    if (email) {
      return order[ORDER_PROPS.EMAIL] === email;
    } else {
      return order[ORDER_PROPS.PHONE] === phone;
    }
  });
  const total = customerOrders.reduce((sum, order) => sum + parseFloat(order[ORDER_PROPS.TOTAL]) * 100 - parseFloat(order[ORDER_PROPS.REFUNDED_AMOUNT]) * 100, 0) / 100;
  return total;
};
const parseCustomerTags = customer => customer[CUSTOMER_PROPS.TAGS] ? customer[CUSTOMER_PROPS.TAGS].split(TAG_SPLITTER) : [];
const stringifyCustomerTags = tags => tags.length
  ? tags.length === 1
    ? tags[0]
      : tags.join(TAG_SPLITTER)
    : '';

const findCustomerFromCustomers = (customers, customerToFind) => customers.find(customer => customer[CUSTOMER_PROPS.EMAIL] === customerToFind[CUSTOMER_PROPS.EMAIL] && customer[CUSTOMER_PROPS.PHONE] === customerToFind[CUSTOMER_PROPS.PHONE]);
const removeVipNameFromTags = (tags, vipNames) => tags.length
  ? tags.filter(tag => !vipNames.some(vipName => vipName === tag))
  : tags;

const filterCustomerHasVipTag = (customer) => parseCustomerTags(customer).some(tag => CONFIGS.VIP_NAMES.some(vipName => vipName === tag));

const CONFIGS = getConfigs();
console.log(CONFIGS);

let CUSTOMER_PROPS_FILTERS = CONFIGS.CUSTOMER_PROPS_FILTERS ? CONFIGS.CUSTOMER_PROPS_FILTERS.concat(CUSTOMER_PROPS.TOTAL_SPENT_IN_DATE_RANGE) : getObjectValues(CUSTOMER_PROPS);
let ORDER_PROPS_FILTERS = CONFIGS.ORDER_PROPS_FILTERS || getObjectValues(ORDER_PROPS);

const customers = getJsonDataFromFilename(CONFIGS.CUSTOMERS_FILE_NAME);
const orders = getJsonDataFromFilename(CONFIGS.ORDERS_FILE_NAME);

const filteredOrders = orders.filter(order => {
  const createdAt = order[ORDER_PROPS.CREATED_AT];
  const timeZone = last(createdAt.split(' '));
  const [startTimeConfig, endTimeConfig] = CONFIGS.VIP_DATES;
  const startTime = moment(`${startTimeConfig} 00:00:00 ${timeZone}`, DEFAULT_TIME_FORMAT);
  const endTime = moment(`${endTimeConfig} 23:59:59 ${timeZone}`, DEFAULT_TIME_FORMAT);
  return order[ORDER_PROPS.TOTAL]
    && parseFloat(order[ORDER_PROPS.TOTAL]) > 0
    && ['paid', 'partially_refunded'].includes(order[ORDER_PROPS.FINANCIAL_STATUS])
    && moment(createdAt, DEFAULT_TIME_FORMAT).isBetween(startTime, endTime);
  });
writeCsv('[2]filtered_orders.csv', filteredOrders, ORDER_PROPS_FILTERS);

const filteredAndSortedOrders = sortBy(filteredOrders, [ORDER_PROPS.EMAIL, ORDER_PROPS.PHONE]);
writeCsv('[3]filtered_and_sorted_orders.csv', filteredAndSortedOrders, ORDER_PROPS_FILTERS);

const filteredCustomers = customers.filter(customer => parseFloat(customer[CUSTOMER_PROPS.TOTAL_SPENT]) >= CONFIGS.VIP_TOTALS[0] && parseInt(customer[CUSTOMER_PROPS.TOTAL_ORDERS]) > 0)
  .map(customer => {
    addCustomerTotalSpentInDateRange(customer, getCustomerOrdersTotal(customer, filteredAndSortedOrders));

    return customer;
  });
writeCsv('[1]filtered_customers.csv', filteredCustomers, CUSTOMER_PROPS_FILTERS);

const vipCustomersNow = customers.filter(customer => !!customer[CUSTOMER_PROPS.TAGS]).filter(filterCustomerHasVipTag);
writeCsv('[4]vip_customers_now.csv', vipCustomersNow, CUSTOMER_PROPS_FILTERS);

const newVipCustomers = customers.map(customer => {
  const ordersTotal = getCustomerOrdersTotal(customer, filteredAndSortedOrders);
  const tags = parseCustomerTags(customer);

  let vipName = '';
  CONFIGS.VIP_TOTALS.map((vipTotal, vipIdx, vipTotals) => {
    if (!vipName) {
      const isLast = vipIdx === vipTotals.length - 1;
      if (isLast) {
        if (vipTotal <= ordersTotal) {
          vipName = CONFIGS.VIP_NAMES[vipIdx];
        }
      } else {
        if (vipTotal <= ordersTotal && ordersTotal < vipTotals[vipIdx + 1]) {
          vipName = CONFIGS.VIP_NAMES[vipIdx];
        }
      }
    }
  });
  
  const vipNameRevomedTags = removeVipNameFromTags(tags, CONFIGS.VIP_NAMES);
  const newTags = stringifyCustomerTags(vipName ? [vipName].concat(vipNameRevomedTags) : vipNameRevomedTags);
  customer[CUSTOMER_PROPS.TAGS] = newTags;
  addCustomerTotalSpentInDateRange(customer, ordersTotal);

  return customer;
})
.filter(filterCustomerHasVipTag);
writeCsv('[5]vip_customers_new.csv', newVipCustomers, CUSTOMER_PROPS_FILTERS);

CONFIGS.VIP_NAMES.forEach((vipName) => {
  const levelFilteredNewVipCustomers = newVipCustomers.filter(customer => {
    const tags = parseCustomerTags(customer);
  
    return tags.includes(vipName);
  });
  writeCsv(`[5-1]vip_customers_new_filtered_by_${vipName}.csv`, levelFilteredNewVipCustomers, CUSTOMER_PROPS_FILTERS);
});

const modifiedCustomers = customers
  .filter(customer => findCustomerFromCustomers(vipCustomersNow, customer) || findCustomerFromCustomers(newVipCustomers, customer))
  .map(customer => {
    const tags = parseCustomerTags(customer);
    const newVipCustomer = findCustomerFromCustomers(newVipCustomers, customer);
    if (newVipCustomer) {
      customer[CUSTOMER_PROPS.TAGS] = newVipCustomer[CUSTOMER_PROPS.TAGS];
    } else {
      customer[CUSTOMER_PROPS.TAGS] = stringifyCustomerTags(removeVipNameFromTags(tags, CONFIGS.VIP_NAMES));
    }
    addCustomerTotalSpentInDateRange(customer, getCustomerOrdersTotal(customer, filteredAndSortedOrders));

    return customer;
  });

writeCsv('[6]modified_customers.csv', modifiedCustomers, CONFIGS.FILTER_MODIFIED_CUSTOMERS && CUSTOMER_PROPS_FILTERS);

function addCustomerTotalSpentInDateRange(customer, numTotal) {
  customer[CUSTOMER_PROPS.TOTAL_SPENT_IN_DATE_RANGE] = numTotal.toString();
}
