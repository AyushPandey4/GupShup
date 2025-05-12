const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['audio', 'video'],
    required: true
  },
  isGroup: {
    type: Boolean,
    default: false
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  initiator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['ringing', 'ongoing', 'ended', 'missed'],
    default: 'ringing'
  },
  startTime: Date,
  endTime: Date,
  duration: Number
}, {
  timestamps: true
});

module.exports = mongoose.model('Call', callSchema);