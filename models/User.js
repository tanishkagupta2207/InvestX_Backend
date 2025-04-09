const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    userName:{
        type: String,
        required: true
    },
    name:{
        type: String,
        required: true
    },
    email:{
        type: String,
        required: true,
        unique: true
    },
    password:{
        type: String,
        required: true
    },
    balance:{
        type: Number,
        required: true,
        default: 100000
    },
    profileType:{
        type: String,
        enum: ["Private", "Public"],
        required: true,
        default: 'Public'
    },
    date:{
        type: Date,
        default: Date.now
    },
});

module.exports = mongoose.model('user', UserSchema);