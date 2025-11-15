const express = require("express");
const User = require("../models/User");
const Portfolio = require("../models/Portfolio");
const Securities = require("../models/Securities");
const UserHolding = require("../models/UserHolding");
const Company = require("../models/Company");
const Transactions = require("../models/Transactions");
const fetchUser = require("../middleware/fetchUser");
const MutualFund = require("../models/MutualFund");

const router = express.Router();

// A simple XIRR implementation
const xirr = (values, dates, guess = 0.1) => {
    // Basic validation
    if (values.length !== dates.length || values.length < 2) {
        return NaN;
    }
    // Check if there are both positive and negative values
    const hasNegative = values.some(val => val < 0);
    const hasPositive = values.some(val => val > 0);
    if (!hasNegative || !hasPositive) {
        return NaN;
    }

    const maxIterations = 100;
    const precision = 0.00000001;
    let rate = guess;

    // Helper function to calculate NPV
    const npv = (rate, values, dates) => {
        let sum = 0;
        for (let i = 0; i < values.length; i++) {
            const days = (dates[i] - dates[0]) / (1000 * 60 * 60 * 24);
            sum += values[i] / Math.pow(1 + rate, days / 365.25);
        }
        return sum;
    };

    // Newton-Raphson method to find the root
    for (let i = 0; i < maxIterations; i++) {
        let f = npv(rate, values, dates);
        let fPrime = 0;
        for (let j = 0; j < values.length; j++) {
            const days = (dates[j] - dates[0]) / (1000 * 60 * 60 * 24);
            fPrime -= values[j] * days / 365.25 * Math.pow(1 + rate, -1 - days / 365.25);
        }

        const newRate = rate - f / fPrime;
        if (Math.abs(newRate - rate) < precision) {
            return newRate;
        }
        rate = newRate;
    }
    return NaN;
};

// You need to define this function, which calculates the current value of the portfolio.
const calculateFinalPortfolioValue = async (userId) => {
    try {
        const portfolioData = await Portfolio.findOne({ user_id: userId }).lean();
        if (!portfolioData) return 0;

        const userHoldings = await UserHolding.find({ portfolio_id: portfolioData._id }).lean();
        const securityIds = userHoldings.map(h => h.security_id);

        const latestPrices = await Securities.aggregate([
            {
                $match: {
                    security_id: { $in: securityIds },
                    date: { $lte: new Date() },
                    granularity: "daily"
                }
            },
            {
                $sort: { date: -1 }
            },
            {
                $group: {
                    _id: "$security_id",
                    latest_price: { $first: "$close_price" },
                    latest_nav: { $first: "$nav" },
                    security_type: { $first: "$security_type" }
                }
            }
        ]);

        let finalValue = 0;
        userHoldings.forEach(holding => {
            const latestPriceDoc = latestPrices.find(p => p._id.toString() === holding.security_id.toString());
            if (latestPriceDoc) {
                const currentPrice = latestPriceDoc.security_type === 'mutualfund' ? latestPriceDoc.latest_nav : latestPriceDoc.latest_price;
                finalValue += holding.quantity * currentPrice;
            }
        });

        // Add the user's current cash balance to the final value
        const user = await User.findById(userId);
        if (user) {
            finalValue += user.balance;
        }

        return finalValue;

    } catch (err) {
        console.error("Error calculating final portfolio value:", err);
        return 0;
    }
};

const calculateUserXIRR = async (userId) => {
    try {
        const allCashFlows = [];
        const user = await User.findById(userId);
        if (!user) {
            throw new Error("User not found.");
        }

        // Fetch all transactions (buy/sell)
        const transactions = await Transactions.find({ user_id: userId }).sort({ date: 1 });
        transactions.forEach((transaction) => {
            const amount = transaction.action === "Buy"
                ? -(transaction.trade_price * transaction.quantity) // Buy is an outflow
                : transaction.trade_price * transaction.quantity; // Sell is an inflow
            allCashFlows.push({ amount, date: transaction.date });
        });

        // Add the initial cash flow (outflow)
        // This is a crucial step to start the cash flow stream.
        if (allCashFlows.length > 0) {
            allCashFlows.unshift({ amount: -user.initialBalance, date: new Date(user.date) });
        } else {
            // If no transactions, the initial balance is the final value
            return 0;
        }

        // Calculate final portfolio value
        const finalPortfolioValue = await calculateFinalPortfolioValue(userId);
        allCashFlows.push({ amount: finalPortfolioValue, date: new Date() });

        // Sort all cash flows by date
        allCashFlows.sort((a, b) => a.date - b.date);

        const cashFlows = allCashFlows.map((cf) => cf.amount);
        const dates = allCashFlows.map((cf) => cf.date);

        const hasNegative = cashFlows.some((amount) => amount < 0);
        const hasPositive = cashFlows.some((amount) => amount > 0);

        let xirrResult = null;
        if (hasNegative && hasPositive && cashFlows.length > 1) {
            xirrResult = xirr(cashFlows, dates);
        } else {
            console.warn("XIRR calculation could not be performed due to invalid cash flows.");
        }

        return xirrResult;
    } catch (err) {
        console.error("Error calculating XIRR:", err.message);
        throw err;
    }
};

// --- Universal Portfolio Retrieval Function ---
const fetchAndFormatPortfolio = async (targetUserId) => {
    // 1. Basic Data Retrieval
    const user = await User.findById(targetUserId);
    if (!user) {
        throw new Error("User not found.");
    }
    const userBalance = user.balance || 0;
    const portfolioData = await Portfolio.findOne({ user_id: targetUserId }).lean();
    if (!portfolioData) {
        return { stocks: [], mutualFunds: [], Balance: userBalance, xirr: 0 };
    }
    const userHoldings = await UserHolding.find({ portfolio_id: portfolioData._id }).lean();
    if (!userHoldings || userHoldings.length === 0) {
        return { stocks: [], mutualFunds: [], Balance: userBalance, xirr: 0 };
    }

    // 2. Prepare Data and Fetch Prices
    const simulatedDate = new Date();
    const stockHoldings = userHoldings.filter((h) => h.security_type === "company");
    const mutualFundHoldings = userHoldings.filter((h) => h.security_type === "mutualfund");

    // Get all unique IDs
    const stockIds = stockHoldings.map((s) => s.security_id);
    const mutualFundIds = mutualFundHoldings.map((mf) => mf.security_id);

    // Fetch details for all companies and mutual funds
    const companyDetails = await Company.find({ _id: { $in: stockIds } }).lean();
    const mutualFundDetails = await MutualFund.find({ _id: { $in: mutualFundIds } }).lean();

    // Fetch the latest prices/NAVs for all securities in one go
    const latestPricesAndNAVs = await Securities.aggregate([
        {
            $match: {
                security_id: { $in: [...stockIds, ...mutualFundIds] },
                date: { $lte: simulatedDate },
                granularity: "daily",
            },
        },
        { $sort: { date: -1 } },
        {
            $group: {
                _id: "$security_id",
                current_price: { $first: "$close_price" },
                current_nav: { $first: "$nav" },
                security_type: { $first: "$security_type" },
            },
        },
    ]);
    const priceMap = latestPricesAndNAVs.reduce((map, item) => {
        const price = item.security_type === 'mutualfund' ? item.current_nav : item.current_price;
        map[item._id.toString()] = price;
        return map;
    }, {});
    const stockDetailsMap = companyDetails.reduce((map, company) => {
        map[company._id.toString()] = company;
        return map;
    }, {});
    const mutualFundDetailsMap = mutualFundDetails.reduce((map, fund) => {
        map[fund._id.toString()] = fund;
        return map;
    }, {});

    // 3. Format Stock Data
    const stocks = stockHoldings.map((holding) => {
        const details = stockDetailsMap[holding.security_id.toString()] || {};
        const currentPrice = priceMap[holding.security_id.toString()] || 0;
        return {
            id: holding.security_id,
            name: details.name,
            symbol: details.symbol,
            quantity: holding.quantity,
            average_price: holding.average_price,
            current_price: currentPrice,
        };
    });

    // 4. Format Mutual Fund Data
    const mutualFunds = mutualFundHoldings.map((holding) => {
        const details = mutualFundDetailsMap[holding.security_id.toString()] || {};
        const currentNav = priceMap[holding.security_id.toString()] || 0;
        return {
            id: holding.security_id,
            name: details.name,
            quantity: holding.quantity,
            average_price: holding.average_price,
            current_price: currentNav,
        };
    });

    // 5. Calculate XIRR
    const xirrValue = await calculateUserXIRR(targetUserId);

    return { stocks, mutualFunds, Balance: userBalance, xirr: xirrValue === null ? 0 : xirrValue };
};

// --- API Routes ---

// Route 1: Get MY Portfolio (Secure, requires authentication)
router.get("/getPortfolio", fetchUser, async (req, res) => {
    const userId = req.user.id;
    try {
        const responseData = await fetchAndFormatPortfolio(userId);
        res.status(200).json({ success: true, data: responseData });
    } catch (error) {
        console.error("Error fetching portfolio:", error);
        res.status(500).json({
            success: false,
            error: "Internal server error while fetching portfolio.",
        });
    }
});

// Route 2: Get Public Portfolio by User ID (Handles access control)
router.get("/:userId", async (req, res) => {
    const { userId } = req.params;

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

        const responseData = await fetchAndFormatPortfolio(userId);

        res.status(200).json({ success: true, data: responseData });

    } catch (error) {
        console.error("Error fetching public profile:", error);
        res.status(500).json({
            success: false,
            msg: "Invalid Request or server error.",
        });
    }
});

module.exports = router;