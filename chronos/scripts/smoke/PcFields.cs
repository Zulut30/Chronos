using System;
using System.IO;
using System.Windows.Forms;

class PcFields {
    [STAThread]
    static void Main(string[] args) {
        var form = new Form { Text = "Chronos isolated test" };
        var panel = new FlowLayoutPanel { Dock = DockStyle.Fill };
        var first = new TextBox { Name = "First", AccessibleName = "First", TabIndex = 0 };
        var second = new TextBox { Name = "Second", AccessibleName = "Second", TabIndex = 1 };
        var check = new Button { Name = "Check", AccessibleName = "Check", Text = "Check", TabIndex = 2 };
        check.Click += delegate { File.WriteAllText(args[0], first.Text + "/" + second.Text); };
        panel.Controls.AddRange(new Control[] { first, second, check });
        form.Controls.Add(panel);
        form.Shown += delegate { File.WriteAllText(args[0] + ".ready", "shown"); };
        Application.Run(form);
    }
}
