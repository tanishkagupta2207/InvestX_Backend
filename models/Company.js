const mongoose = require('mongoose');

const CompanySchema = new mongoose.Schema({
    name:{
        type: String,
        required: true
    },
    symbol:{
        type: String,
        required: true,
        unique: true
    },
    sector:{
        type: String,
        enum: ["Technology", "Pharmaceuticals", "Renewable_Energy", "Financial_Services", "Consumer_Goods", "Automobile", "Infrastructure", "Energy", "Telecommunications","Metals_And_Mining"],
        required: true,
        default: "Technology"
    },
    date:{
        type: Date,
        default: Date.now
    },
});

module.exports = mongoose.model('company', CompanySchema);