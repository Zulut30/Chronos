using System;
using System.IO;
using System.Windows.Forms;

class PcFields {
    [STAThread]
    static void Main(string[] args) {
        var form = new Form { Text = "Chronos isolated test" };
        var panel = new FlowLayoutPanel { Dock = DockStyle.Fill };
        var first = new TextBox { AccessibleName = "First" };
        var second = new TextBox { AccessibleName = "Second" };
        var check = new Button { Text = "Check" };
        check.Click += delegate { File.WriteAllText(args[0], first.Text + "/" + second.Text); };
        panel.Controls.AddRange(new Control[] { first, second, check });
        form.Controls.Add(panel);
        Application.Run(form);
    }
}
