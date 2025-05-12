const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  isGroup: {
    type: Boolean,
    default: false
  },
  name: {
    type: String,
    trim: true,
    required: function() {
      return this.isGroup;
    }
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  admins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Chat', chatSchema);