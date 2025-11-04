// Import necessary libraries
const yahooFinance = require("yahoo-finance2").default;
const Company = require("../models/Company");
const MutualFund = require("../models/MutualFund");
const Securities = require("../models/Securities");
const connectToMongoDB = require("../dbConnect");
const axios = require("axios");
const {getSimulatedPrevDate, getSimulatedNextDate} = require("../utils/DateUtils");

// --- Date Calculation ---
const simulatedDateToday = getSimulatedPrevDate();
simulatedDateToday.setHours(0, 0, 0, 0); // Normalize to start of the day
const startDate = new Date();
startDate.setFullYear(startDate.getFullYear() - 2);

// Format dates for yahoo-finance2 (YYYY-MM-DD)
const formatYMD = (date) => date.toISOString().split("T")[0];
const period1 = formatYMD(startDate);
const period2 = formatYMD(simulatedDateToday);

// --- Data Fetching for Stocks ---
async function fetchHistoricalData(symbol) {
  console.log(
    `Fetching stock data for ${symbol} from ${period1} to ${period2}...`
  );
  try {
    const queryOptions = {
      period1: period1,
      period2: period2,
      interval: "1d",
    };
    const results = await yahooFinance.historical(symbol, queryOptions);
    console.log(`Fetched ${results.length} records for ${symbol}.`);
    return results;
  } catch (error) {
    console.error(`Error fetching data for ${symbol}:`, error.message);
    if (
      error.name === "FailedYahooValidationError" ||
      error.message.includes("404")
    ) {
      console.warn(`Symbol ${symbol} might be invalid or delisted. Skipping.`);
    } else {
      console.error(error);
    }
    return null;
  }
}

// --- Data Fetching for Mutual Funds ---
const MFAPI_BASE_URL =  process.env.REACT_APP_MFAPI_BASE_URL;

// Function to fetch and filter historical NAV for a scheme
async function fetchHistoricalNav(schemeCode) {
    console.log(`Fetching all historical NAV for scheme code ${schemeCode}...`);
    try {
        const response = await axios.get(`${MFAPI_BASE_URL}${schemeCode}`);
        const data = response.data;

        if (!data || !data.data) {
            console.log("No data found in the API response.");
            return [];
        }

        const allNavData = data.data;
        const documentsToStore = [];
        
        // Calculate the cutoff date (2 years ago from today)
        const cutoffDate = new Date(simulatedDateToday);
        cutoffDate.setFullYear(simulatedDateToday.getFullYear() - 2);

        console.log(`Filtering data after cutoff date: ${cutoffDate.toISOString().split('T')[0]}`);

        // Iterate through the historical data and only select records within the last 2 years
        for (const record of allNavData) {
            // The date format is DD-MM-YYYY, so it needs to be reversed for the Date constructor
            const recordDate = new Date(record.date.split('-').reverse().join('-'));

            // If the record date is older than the cutoff date, stop processing
            if (recordDate < cutoffDate) {
                break;
            }

            // Otherwise, add the record to our list
            documentsToStore.push({
                date: recordDate,
                nav: parseFloat(record.nav),
            });
        }
        
        console.log(`Filtered down to ${documentsToStore.length} records within the last 2 years.`);
        return documentsToStore;

    } catch (error) {
        console.error(`Error fetching NAV for scheme code ${schemeCode}:`, error.message);
        return null;
    }
}

// --- Data Storage for Stocks ---
async function storeHistoricalData(securityId, symbol, data) {
  if (!data || data.length === 0) {
    console.log(`No data provided to store for ${symbol}.`);
    return;
  }

  const documents = data.map((record) => ({
    security_id: securityId,
    security_type: "company",
    date: getSimulatedNextDate(new Date(record.date)),
    open_price: record.open,
    high_price: record.high,
    low_price: record.low,
    close_price: record.adjClose,
    volume: record.volume,
    granularity: "daily",
  }));

  const bulkOps = documents.map((doc) => ({
    updateOne: {
      filter: { security_id: doc.security_id, date: doc.date },
      update: { $set: doc },
      upsert: true,
    },
  }));

  try {
    if (bulkOps.length > 0) {
      const result = await Securities.bulkWrite(bulkOps); // Corrected to Securities
      console.log(
        `Stored data for ${symbol}. Upserted: ${result.upsertedCount}, Modified: ${result.modifiedCount}`
      );
    } else {
      console.log(`No documents prepared for bulk write for ${symbol}.`);
    }
  } catch (error) {
    console.error(`Error storing data for ${symbol} in MongoDB:`, error);
  }
}

// --- Data Storage for Mutual Funds ---
async function storeHistoricalNav(securityId, name, data) {
    if (!data || data.length === 0) {
        console.log(`No data provided to store for ${name}.`);
        return;
    }
    
    // The documents are already in the correct format from fetchHistoricalNav
    const documents = data.map((record) => ({
        security_id: securityId,
        security_type: "mutualfund",
        date: getSimulatedNextDate(new Date(record.date)),
        nav: record.nav,
        granularity: "daily",
    }));

    const bulkOps = documents.map((doc) => ({
        updateOne: {
            filter: { security_id: doc.security_id, date: doc.date },
            update: { $set: doc },
            upsert: true,
        },
    }));

    try {
        if (bulkOps.length > 0) {
            const result = await Securities.bulkWrite(bulkOps);
            console.log(
                `Stored NAV data for ${name}. Upserted: ${result.upsertedCount}, Modified: ${result.modifiedCount}`
            );
        }
    } catch (error) {
        console.error(`Error storing NAV data for ${name} in MongoDB:`, error);
    }
}

// --- Main Execution ---
async function run() {
  await connectToMongoDB();
  console.log("Starting data fetch process for all securities...");

  // --- Process Mutual Funds ---
  console.log("\n--- Processing Mutual Funds ---");
  const mutualFunds = await MutualFund.find();
  for (let i = 0; i < mutualFunds.length; i++) {
    const fund = mutualFunds[i];
    const historicalNav = await fetchHistoricalNav(fund.scheme_code);
    if (historicalNav) {
      await storeHistoricalNav(fund._id, fund.name, historicalNav);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log("Finished processing all Mutual Funds.");

  // --- Process Stocks ---
  console.log("\n--- Processing Stocks ---");
  const companies = await Company.find();
  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    const historicalData = await fetchHistoricalData(company.symbol);
    if (historicalData) {
      await storeHistoricalData(company._id, company.symbol, historicalData);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log("Finished processing all Stocks.");
}

run();