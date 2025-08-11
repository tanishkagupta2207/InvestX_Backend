const express = require("express");
const User = require("../models/User");
const Portfolio = require("../models/Portfolio");
const Stocks = require("../models/Stocks");
const UserStocks = require("../models/UserStocks");
const Company = require("../models/Company");
const Finance = require('financejs'); // Correct import for financejs
const finance = new Finance();
const Transactions = require("../models/Transactions");
const fetchUser = require("../middleware/fetchUser");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const router = express.Router();

const calculateFinalPortfolioValue = async (userId) => {
  try {
    // 1. Get the user's current cash balance
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found.");
    }
    let totalValue = user.balance;

    // 2. Find the user's portfolio to get the portfolio ID
    const portfolio = await Portfolio.findOne({ user_id: userId });
    if (!portfolio) {
      // If a user has no portfolio, their value is just their cash balance
      return parseFloat(totalValue.toFixed(2));
    }
    const portfolioId = portfolio._id;

    // 3. Find all stocks held by the user in their portfolio
    const userStocks = await UserStocks.find({ portfolio_id: portfolioId });

    // If the user holds no stocks, return the cash balance
    if (userStocks.length === 0) {
      return parseFloat(totalValue.toFixed(2));
    }

    // 4. Iterate through each stock and get its current market price
    for (const stock of userStocks) {
      // Find the latest stock price for the company.
      // We assume the most recent 'daily' close price is the current price.
      const latestStockData = await Stocks.findOne({
        company_id: stock.company_id,
        granularity: "daily",
        date: { $lte: new Date() },
      })
        .sort({ date: -1 })
        .limit(1);

      if (latestStockData) {
        // 5. Calculate the value of this stock holding and add it to the total
        totalValue += stock.quantity * latestStockData.close_price;
      }
    }

    // 6. Return the total portfolio value
    return parseFloat(totalValue.toFixed(2));
  } catch (err) {
    console.error("Error calculating final portfolio value:", err.message);
    throw err;
  }
};

/**
 * Calculates the Extended Internal Rate of Return (XIRR) for a user's portfolio.
 * The function fetches all cash flows (initial balance, transactions, and final portfolio value)
 * and uses the financejs library to compute the XIRR.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<number|null>} The calculated XIRR as a decimal, or null if the calculation fails.
 */
const calculateUserXIRR = async (userId) => {
  try {
    const allCashFlows = [];

    // 1. Fetch initial investment
    const user = await User.findById(userId);
    if (!user) {
      // Throw an error if the user is not found, as we cannot proceed.
      throw new Error("User not found.");
    }
    // Treat the initial balance as a negative cash flow (outflow)
    allCashFlows.push({ amount: -user.balance, date: user.date });

    // 2. Fetch all transactions (buy/sell)
    const transactions = await Transactions.find({ user_id: userId });
    transactions.forEach((transaction) => {
      const amount =
        transaction.action === "Buy"
          ? -(transaction.trade_price * transaction.quantity) // Buy is an outflow
          : transaction.trade_price * transaction.quantity;  // Sell is an inflow
      allCashFlows.push({ amount, date: transaction.date });
    });

    // 3. Calculate final portfolio value
    const finalPortfolioValue = await calculateFinalPortfolioValue(userId);
    // Add final portfolio value as the last positive cash flow
    allCashFlows.push({ amount: finalPortfolioValue, date: new Date() });

    // 4. Sort all cash flows by date to ensure correct order for XIRR
    allCashFlows.sort((a, b) => a.date - b.date);

    // 5. Separate the sorted data into two arrays for the XIRR function
    const cashFlows = allCashFlows.map(cf => cf.amount);
    const dates = allCashFlows.map(cf => cf.date);

    // 6. Validate the cash flows before attempting calculation
    const hasNegative = cashFlows.some(amount => amount < 0);
    const hasPositive = cashFlows.some(amount => amount > 0);

    let xirrResult = null;
    if (hasNegative && hasPositive && cashFlows.length > 1) {
      xirrResult = finance.XIRR(cashFlows, dates);
    } else {
      console.warn('XIRR calculation could not be performed due to invalid cash flows (needs at least one negative and one positive cash flow).');
    }

    return xirrResult;

  } catch (err) {
    console.error("Error calculating XIRR:", err.message);
    throw err;
  }
};

// GET route for portfolio data for a specific user
router.get("/getPortfolio", fetchUser, async (req, res) => {
  const userId = req.user.id;
  if (!userId) {
    return res
      .status(400)
      .json({ success: false, error: "User ID parameter is required." });
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }
    // ACTION VERIFIED CAN RETURN USER PORTFOLIO
    try {
      const userBalance = user.balance || 0;

      const portfolioData = await Portfolio.findOne({ user_id: userId }).lean();
      if (!portfolioData) {
        return res.status(200).json({
          success: true,
          data: { stocks: [], Balance: userBalance },
        });
      }

      const userStocks = await UserStocks.find({
        portfolio_id: portfolioData._id,
      }).lean();

      if (!userStocks || userStocks.length === 0) {
        return res.status(200).json({
          success: true,
          data: { stocks: [], Balance: userBalance },
        });
      }

      const companyIds = [
        ...new Set(
          userStocks.map((stock) => stock.company_id).filter((id) => id != null)
        ),
      ];

      let companyMap = {};
      if (companyIds.length > 0) {
        const companies = await Company.find(
          {
            _id: { $in: companyIds },
          },
          "name symbol _id"
        ).lean();

        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);

        const latestStockData = await Stocks.aggregate([
          {
            $match: {
              company_id: { $in: companyIds },
              date: { $lte: yesterday },
            },
          },
          {
            $sort: {
              date: -1,
            },
          },
          {
            $group: {
              _id: "$company_id",
              latest_doc_id: { $first: "$_id" },
              current_price: { $first: "$close_price" },
              latestDate: { $first: "$date" },
            },
          },
          // Stage 4: (Optional) Reshape the output documents
          {
            $project: {
              _id: 0,
              company_id: "$_id", // Rename the group key back to company_id
              current_price: 1, // Include the latest current_price
              latestDate: 1, // Include the date associated with this price
            },
          },
        ]);

        const current_priceMap = latestStockData.reduce((map, stockInfo) => {
          map[stockInfo.company_id.toString()] = stockInfo.current_price || 0;
          return map;
        }, {});

        companyMap = companies.reduce((map, company) => {
          map[company._id.toString()] = {
            name: company.name || "N/A",
            symbol: company.symbol || "N/A",
            current_price: current_priceMap[company._id.toString()] || 0,
          };
          return map;
        }, {});
      } else {
        console.log(
          `[${new Date().toISOString()}] No valid company IDs found in user stocks.`
        );
      }

      const portfolioStocks = userStocks
        .map((userStock) => {
          const companyDetails = companyMap[
            userStock.company_id?.toString()
          ] || {
            name: "Unknown",
            symbol: "N/A",
            current_price: 0,
          };
          return {
            // Use company_id string as the 'id' in the response
            id: userStock.company_id?.toString() || "unknown",
            name: companyDetails.name,
            symbol: companyDetails.symbol,
            quantity: userStock.quantity || 0,
            average_price: userStock.average_price || 0,
            current_price: companyDetails.current_price, // Use fetched current price
          };
        })
        .filter((stock) => stock.id !== "unknown"); // Filter out stocks where company_id was missing

      // Fetch XIRR for the user
      const xirr = await calculateUserXIRR(userId);
      
      const responseData = {
        stocks: portfolioStocks,
        Balance: userBalance,
        xirr: xirr
      };

      res.status(200).json({ success: true, data: responseData });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Internal server error while fetching portfolio.",
      });
    }
  } catch (error) {
    if (!res.headersSent) {
      res
        .status(500)
        .json({ success: false, error: "Invalid Request or server error." });
    }
  }
});

router.get("/:userId", async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res
      .status(400)
      .json({ success: false, error: "User ID is required." });
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, msg: "User not found." });
    }
    if (user.profileType === "Private") {
      return res.status(403).json({
        success: false,
        msg: "Access denied: This is a private profile.",
      });
    }
    try {
      const userBalance = user.balance || 0;

      const portfolioData = await Portfolio.findOne({ user_id: userId }).lean();
      if (!portfolioData) {
        return res.status(200).json({
          success: true,
          data: { stocks: [], Balance: userBalance },
        });
      }

      const userStocks = await UserStocks.find({
        portfolio_id: portfolioData._id,
      }).lean();

      if (!userStocks || userStocks.length === 0) {
        return res.status(200).json({
          success: true,
          data: { stocks: [], Balance: userBalance },
        });
      }

      const companyIds = [
        ...new Set(
          userStocks.map((stock) => stock.company_id).filter((id) => id != null)
        ),
      ];

      let companyMap = {};
      if (companyIds.length > 0) {
        const companies = await Company.find(
          {
            _id: { $in: companyIds },
          },
          "name symbol _id"
        ).lean();

        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);

        const latestStockData = await Stocks.aggregate([
          {
            $match: {
              company_id: { $in: companyIds },
              date: { $lte: yesterday },
            },
          },
          {
            $sort: {
              date: -1,
            },
          },
          {
            $group: {
              _id: "$company_id",
              latest_doc_id: { $first: "$_id" },
              current_price: { $first: "$close_price" },
              latestDate: { $first: "$date" },
            },
          },
          // Stage 4: (Optional) Reshape the output documents
          {
            $project: {
              _id: 0,
              company_id: "$_id", // Rename the group key back to company_id
              current_price: 1, // Include the latest current_price
              latestDate: 1, // Include the date associated with this price
            },
          },
        ]);

        const current_priceMap = latestStockData.reduce((map, stockInfo) => {
          map[stockInfo.company_id.toString()] = stockInfo.current_price || 0;
          return map;
        }, {});

        companyMap = companies.reduce((map, company) => {
          map[company._id.toString()] = {
            name: company.name || "N/A",
            symbol: company.symbol || "N/A",
            current_price: current_priceMap[company._id.toString()] || 0,
          };
          return map;
        }, {});
      } else {
        console.log(
          `[${new Date().toISOString()}] No valid company IDs found in user stocks.`
        );
      }

      const portfolioStocks = userStocks
        .map((userStock) => {
          const companyDetails = companyMap[
            userStock.company_id?.toString()
          ] || {
            name: "Unknown",
            symbol: "N/A",
            current_price: 0,
          };
          return {
            id: userStock.company_id?.toString() || "unknown",
            name: companyDetails.name,
            symbol: companyDetails.symbol,
            quantity: userStock.quantity || 0,
            average_price: userStock.average_price || 0,
            current_price: companyDetails.current_price,
          };
        })
        .filter((stock) => stock.id !== "unknown");

      // Fetch XIRR for the user
      const xirr = await calculateUserXIRR(userId);

      const responseData = {
        stocks: portfolioStocks,
        Balance: userBalance,
        xirr: xirr
      };

      res.status(200).json({ success: true, data: responseData });
    } catch (error) {
      res.status(500).json({
        success: false,
        msg: "Internal server error while fetching portfolio.",
      });
    }
  } catch (error) {
    if (!res.headersSent) {
      res
        .status(500)
        .json({ success: false, msg: "Invalid Request or server error." });
    }
  }
});

module.exports = router;
