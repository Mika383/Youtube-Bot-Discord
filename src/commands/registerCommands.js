const { SlashCommandBuilder } = require('discord.js');

function getCommandDefinitions() {
  const commands = [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('Phát theo tên bài hát, URL video hoặc URL playlist YouTube')
      .addStringOption((option) => option
        .setName('input')
        .setDescription('Tên bài hát, URL video hoặc URL playlist YouTube')
        .setRequired(true))
      .addBooleanOption((option) => option
        .setName('infinite')
        .setDescription('Lặp vô hạn khi nội dung là playlist YouTube')),
    new SlashCommandBuilder().setName('skip').setDescription('Bỏ qua bài hiện tại'),
    new SlashCommandBuilder().setName('stop').setDescription('Dừng nhạc và xóa hàng chờ'),
    new SlashCommandBuilder().setName('queue').setDescription('Xem hàng chờ hiện tại'),
    new SlashCommandBuilder().setName('shuffle').setDescription('Bật hoặc tắt chế độ trộn bài'),
    new SlashCommandBuilder().setName('leave').setDescription('Rời kênh thoại'),
    new SlashCommandBuilder().setName('kill').setDescription('Hủy phiên phát và rời kênh thoại ngay lập tức'),
    new SlashCommandBuilder().setName('present').setDescription('Hiển thị lại bảng điều khiển đang phát'),
    new SlashCommandBuilder().setName('playlist').setDescription('Mở bảng quản lý playlist cá nhân'),
    new SlashCommandBuilder().setName('ringo').setDescription('Hiển thị hướng dẫn và toàn bộ lệnh của bot'),
  ];

  return commands.map((command) => command.setDMPermission(false));
}

module.exports = {
  getCommandDefinitions,
};
