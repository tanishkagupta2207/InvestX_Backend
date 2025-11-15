const express = require("express");
const router = express.Router();
const fetchUser = require("../middleware/fetchUser");
const Transactions = require("../models/Transactions");
const Company = require("../models/Company");
const MutualFund = require("../models/MutualFund");
const Portfolio = require("../models/Portfolio");
const User = require("../models/User");
const UserHoldings = require("../models/UserHolding");
const Orders = require("../models/Orders");

// --- UTILITY: TRADING HOURS CHECK ---
const checkTradingHours = (now) => {
  const hour = now.getHours();
  const day = now.getDay();
  // Assuming market is open Monday (1) to Friday (5)
  const isMarketDay = day >= 1 && day <= 5;
  const isNextMarketDay = day >= 2 && day <= 6;
  // Market hours: 4:00 AM (ET) to 8:00 PM (ET) - 13:30 to 5:30(next day) IST
  const isAfterMarketOpenTime =
    hour > 13 || (hour === 13 && now.getMinutes() >= 30);
  const isBeforeMarketCloseTime =
    hour < 5 || (hour === 5 && now.getMinutes() <= 30);

  if (isAfterMarketOpenTime && isMarketDay) return true;
  if (isBeforeMarketCloseTime && isNextMarketDay) return true;

  return false;
};

// =========================================================================
//                             TRANSACTIONS ROUTE
// =========================================================================

router.post("/fetch", fetchUser, async (req, res) => {
  let success = false;
  const { action } = req.body;

  if (action && action !== "Buy" && action !== "Sell") {
    return res
      .status(400)
      .json({ success, msg: "Invalid action. Must be 'Buy' or 'Sell'." });
  }

  try {
    const userId = req.user.id;
    const queryConditions = { user_id: userId };
    if (action) {
      queryConditions.action = action;
    }

    const transactions = await Transactions.find(queryConditions).lean();
    const securityIds = [...new Set(transactions.map((t) => t.security_id))];

    // Fetch details for all involved securities
    const companies = await Company.find(
      { _id: { $in: securityIds } },
      "name _id"
    ).lean();
    const mutualFunds = await MutualFund.find(
      { _id: { $in: securityIds } },
      "name _id"
    ).lean();

    const securityMap = [
      ...companies.map((c) => ({ id: c._id, name: c.name })),
      ...mutualFunds.map((m) => ({ id: m._id, name: m.name })),
    ].reduce((map, sec) => {
      map[sec.id] = sec.name;
      return map;
    }, {});

    // Map security name to each transaction
    const transactionsWithNames = transactions.map((t) => ({
      ...t,
      security_name: securityMap[t.security_id] || "Unknown",
    }));

    success = true;
    res.json({ success, transactions: transactionsWithNames });
  } catch (error) {
    console.error("Error fetching transactions:", error.message);
    res.status(500).json({ success, msg: "Internal error" });
  }
});

// =========================================================================
//                              STOCK ORDER ROUTES
// =========================================================================

// POST route for Market Orders (Stocks)
router.post("/market", fetchUser, async (req, res) => {
  const { quantity, price, action, security_id } = req.body; // Using security_id for consistency
  const userId = req.user.id;
  const quantityNum = parseInt(quantity, 10);
  const security_type = "company";

  if (!quantityNum || !price || !action || !security_id) {
    return res
      .status(400)
      .json({ success: false, msg: "Missing required fields" });
  }

  const now = new Date();
  if (!checkTradingHours(now)) {
    return res
      .status(400)
      .json({
        success: false,
        msg: "Action not allowed during non-market hours.",
      });
  }

  let amountToAdd = quantityNum * price;
  if (action === "BUY") {
    amountToAdd *= -1;
  }

  try {
    const user = await User.findById(userId);
    const portfolio = await Portfolio.findOne({ user_id: userId });
    const company = await Company.findById(security_id);

    if (!user || !portfolio || !company) {
      return res
        .status(400)
        .json({ success: false, msg: "User/Portfolio/Company not found." });
    }

    const userHolding = await UserHoldings.findOne({
      portfolio_id: portfolio._id,
      security_id: security_id,
      security_type: security_type,
    });

    // Basic checks for balance/holdings
    if (action === "SELL") {
      if (!userHolding || userHolding.quantity < quantityNum) {
        return res
          .status(400)
          .json({
            success: false,
            msg: "Not enough quantity of shares to sell!",
          });
      }
    } else {
      if (user.balance + amountToAdd < 0) {
        return res
          .status(400)
          .json({ success: false, msg: "Not enough balance!" });
      }
    }

    const updation_time = new Date(); // Use current date only

    // Transaction
    await Transactions.create({
      user_id: userId,
      security_id: security_id,
      security_type: security_type,
      action: action === "BUY" ? "Buy" : "Sell",
      trade_price: price,
      quantity: quantityNum,
      date: updation_time,
    });

    // Order (FILLED status since it's a market order)
    await Orders.create({
      user_id: userId,
      portfolio_id: portfolio._id,
      security_id: security_id,
      security_type: security_type,
      order_type: action === "BUY" ? "Buy" : "Sell",
      order_sub_type: "MARKET",
      quantity: quantityNum,
      price: price,
      filled_quantity: quantityNum,
      average_fill_price: price,
      status: "FILLED",
      order_updation_date: updation_time,
      date: updation_time,
    });

    // Update user balance
    user.balance += amountToAdd;
    await user.save();

    // Update user holdings logic... (Same as your original logic, using UserHoldings)
    if (userHolding) {
      if (action === "BUY") {
        const oldTotal = userHolding.average_price * userHolding.quantity;
        const total = oldTotal - amountToAdd; // AmountToAdd is negative here
        userHolding.quantity += quantityNum;
        userHolding.average_price = total / userHolding.quantity;
        await userHolding.save();
      } else {
        userHolding.quantity -= quantityNum;
        if (userHolding.quantity === 0) {
          await UserHoldings.deleteOne({ _id: userHolding._id });
        } else {
          await userHolding.save();
        }
      }
    } else if (action === "BUY") {
      await UserHoldings.create({
        portfolio_id: portfolio._id,
        security_id: security_id,
        security_type: security_type,
        quantity: quantityNum,
        average_price: price,
      });
    }

    res
      .status(201)
      .json({
        success: true,
        msg: "Market Order placed and executed successfully",
      });
  } catch (error) {
    console.error("Error processing market order:", error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
});

// Function to create PENDING Stock Order (for Limit, Stop Loss, etc.)
const createPendingStockOrder = async (
  req,
  res,
  orderSubType,
  additionalFields = {}
) => {
  const { quantity, action, security_id, time_in_force } = req.body;
  const userId = req.user.id;
  const quantityNum = parseInt(quantity, 10);
  const security_type = "company";

  if (
    !quantityNum ||
    !action ||
    !security_id ||
    !time_in_force ||
    Object.values(additionalFields).some((val) => !val)
  ) {
    return res
      .status(400)
      .json({ success: false, msg: "Missing required fields" });
  }

  if (!checkTradingHours(new Date())) {
      return res.status(400).json({ success: false, msg: "Orders can't be placed during non-market hours." });
  }

  try {
    const user = await User.findById(userId);
    const portfolio = await Portfolio.findOne({ user_id: userId });
    const company = await Company.findById(security_id);

    if (!user || !portfolio || !company) {
      return res
        .status(400)
        .json({ success: false, msg: "User/Portfolio/Company not found." });
    }

    // Create PENDING Order
    await Orders.create({
      user_id: userId,
      portfolio_id: portfolio._id,
      security_id: security_id,
      security_type: security_type,
      order_type: action === "BUY" ? "Buy" : "Sell",
      order_sub_type: orderSubType,
      quantity: quantityNum,
      status: "PENDING",
      time_in_force: time_in_force,
      date: new Date(), // Use current date only
      ...additionalFields,
    });

    res
      .status(201)
      .json({
        success: true,
        msg: `${orderSubType} Order placed successfully (PENDING).`,
      });
  } catch (error) {
    console.error(`Error placing ${orderSubType} order:`, error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
};

// POST route for Limit Orders (Stocks)
router.post("/limit", fetchUser, async (req, res) => {
  const { limit_price } = req.body;
  await createPendingStockOrder(req, res, "LIMIT", { limit_price });
});

// POST route for Stop Loss Orders (Stocks)
router.post("/stopLoss", fetchUser, async (req, res) => {
  const { stop_price } = req.body;
  await createPendingStockOrder(req, res, "STOP_LOSS", { stop_price });
});

// POST route for Stop Limit Orders (Stocks)
router.post("/stopLimit", fetchUser, async (req, res) => {
  const { stop_price, limit_price } = req.body;
  await createPendingStockOrder(req, res, "STOP_LIMIT", {
    stop_price,
    limit_price,
  });
});

// POST route for Take Profit Orders (Stocks)
router.post("/takeProfit", fetchUser, async (req, res) => {
  const { take_profit_price } = req.body;
  await createPendingStockOrder(req, res, "TAKE_PROFIT", { take_profit_price });
});

// =========================================================================
//                           MUTUAL FUND ORDER ROUTES
// =========================================================================

// Function to create Mutual Fund Order (Market, SIP, SWP)
const createMutualFundOrder = async (req, res, orderSubType) => {
  const { quantity, action, security_id, frequency } = req.body;
  const userId = req.user.id;
  const quantityNum = parseInt(quantity, 10);
  const security_type = "mutualfund";

  // Market orders do not require frequency, SIP/SWP do
  if (
    !quantityNum ||
    !action ||
    !security_id ||
    ((orderSubType === "SIP" || orderSubType === "SWP") && !frequency)
  ) {
    return res
      .status(400)
      .json({ success: false, msg: "Missing required fields" });
  }

  // Mutual fund orders are always accepted as they are processed after market close,
  // but we can reject if outside a reasonable window if you wish.
  // For now, we'll allow placement at any time, as processing is scheduled. 
  // Market Orders only accepted on weekdays
  if(orderSubType === 'MARKET' && new Date().getDay() === 0 || new Date().getDay() === 6) {
    return res
      .status(400)
      .json({
        success: false,
        msg: "Mutual Fund orders cannot be placed on weekends.",
      });
  }

  try {
    const user = await User.findById(userId);
    const portfolio = await Portfolio.findOne({ user_id: userId });
    const fund = await MutualFund.findById(security_id);

    if (!user || !portfolio || !fund) {
      return res
        .status(400)
        .json({ success: false, msg: "User/Portfolio/Mutual Fund not found." });
    }

    // Final check: Mutual Funds only accept Buy/Sell (Market)
    if (orderSubType === "MARKET" && action !== "BUY" && action !== "SELL") {
      return res
        .status(400)
        .json({
          success: false,
          msg: "Invalid action for Mutual Fund Market Order.",
        });
    }
    // SIP/SWP are always PENDING until the scheduler runs
    const status = orderSubType === "MARKET" ? "PENDING" : "PENDING";

    // Create Order
    await Orders.create({
      user_id: userId,
      portfolio_id: portfolio._id,
      security_id: security_id,
      security_type: security_type,
      order_type: action === "BUY" ? "Buy" : "Sell",
      order_sub_type: orderSubType,
      quantity: quantityNum,
      status: status,
      time_in_force: "GTC", // Mutual fund orders are often GTC in spirit
      frequency: frequency, // Only for SIP/SWP
      date: new Date(),
    });

    res
      .status(201)
      .json({
        success: true,
        msg: `${orderSubType} Order placed successfully (PENDING for next NAV).`,
      });
  } catch (error) {
    console.error(`Error placing ${orderSubType} order:`, error.message);
    res.status(500).json({ success: false, msg: "Internal error" });
  }
};

// POST route for Mutual Fund Market Order
router.post("/mf/market", fetchUser, async (req, res) => {
  await createMutualFundOrder(req, res, "MARKET");
});

// POST route for SIP Order
router.post("/mf/sip", fetchUser, async (req, res) => {
  await createMutualFundOrder(req, res, "SIP");
});

// POST route for SWP Order
router.post("/mf/swp", fetchUser, async (req, res) => {
  await createMutualFundOrder(req, res, "SWP");
});

module.exports = router;
