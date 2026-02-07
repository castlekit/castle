"use client";

import { useState } from "react";
import {
  Users,
  TrendingUp,
  Clock,
  Activity,
  Database,
  LayoutDashboard,
  List,
  Table,
} from "lucide-react";

// UI Components
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Input,
  Textarea,
  Badge,
  Avatar,
  AvatarFallback,
  Toggle,
  Select,
  Checkbox,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Alert,
  Slider,
  Tooltip,
  RadioGroup,
  RadioGroupItem,
  OptionCardGroup,
  OptionCard,
  CheckboxCard,
  ToggleGroup,
  ToggleGroupItem,
  Uptime,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Progress,
  Clock as AnalogClock,
} from "@/components/ui";

// Dashboard Components
import {
  GlassCard,
  GreetingWidget,
  WeatherWidget,
  AgentStatusWidget,
  StatWidget,
  StockWidget,
  GoalWidget,
} from "@/components/dashboard";

// Kanban Components
import { KanbanBoard } from "@/components/kanban";

// Layout Components
import { Sidebar, UserMenu } from "@/components/layout";

// Demo section wrapper
function DemoSection({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-16 ${className}`}>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
        {description && <p className="text-foreground-secondary mt-1">{description}</p>}
      </div>
      {children}
    </section>
  );
}

// Subsection wrapper
function DemoSubsection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wider mb-4">
        {title}
      </h3>
      {children}
    </div>
  );
}

export default function UiKitPage() {
  const [toggleState, setToggleState] = useState(false);
  const [toggleState2, setToggleState2] = useState(true);
  const [radioValue, setRadioValue] = useState("option1");
  const [optionCardValue, setOptionCardValue] = useState("plan1");
  const [checkboxCard1, setCheckboxCard1] = useState(true);
  const [checkboxCard2, setCheckboxCard2] = useState(false);
  const [viewMode, setViewMode] = useState("grid");
  const [activeTab, setActiveTab] = useState("general");
  const [checkboxState, setCheckboxState] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar variant="solid" />
      <UserMenu className="fixed top-5 right-6 z-50" variant="solid" />

      <main className="min-h-screen ml-[80px]">
        <div className="p-8 w-full">
          <DemoSection
            title="UI Kit"
            description="Design system + components for Castle"
          >
            <Alert variant="info">
              This is the internal UI kit page. All components from the Castle design system are shown here as a living reference.
            </Alert>
          </DemoSection>

          {/* Section 1: Design Tokens */}
          <DemoSection
            title="Design Tokens"
            description="The foundation of the Castle design system"
          >
            <DemoSubsection title="Colors">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                <div className="space-y-2">
                  <div className="h-16 rounded-[var(--radius-md)] bg-background border border-border" />
                  <p className="text-xs text-foreground-muted">Background</p>
                </div>
                <div className="space-y-2">
                  <div className="h-16 rounded-[var(--radius-md)] bg-background-secondary border border-border" />
                  <p className="text-xs text-foreground-muted">Background Secondary</p>
                </div>
                <div className="space-y-2">
                  <div className="h-16 rounded-[var(--radius-md)] bg-surface border border-border" />
                  <p className="text-xs text-foreground-muted">Surface</p>
                </div>
                <div className="space-y-2">
                  <div className="h-16 rounded-[var(--radius-md)] bg-accent" />
                  <p className="text-xs text-foreground-muted">Accent</p>
                </div>
                <div className="space-y-2">
                  <div className="h-16 rounded-[var(--radius-md)] bg-success" />
                  <p className="text-xs text-foreground-muted">Success</p>
                </div>
                <div className="space-y-2">
                  <div className="h-16 rounded-[var(--radius-md)] bg-error" />
                  <p className="text-xs text-foreground-muted">Error</p>
                </div>
              </div>
            </DemoSubsection>

            <DemoSubsection title="Typography">
              <div className="space-y-4">
                <div>
                  <p className="text-5xl font-semibold text-foreground">Display Text</p>
                  <p className="text-xs text-foreground-muted mt-1">48px / Semibold</p>
                </div>
                <div>
                  <p className="text-3xl font-semibold text-foreground">Heading 1</p>
                  <p className="text-xs text-foreground-muted mt-1">32px / Semibold</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold text-foreground">Heading 2</p>
                  <p className="text-xs text-foreground-muted mt-1">24px / Semibold</p>
                </div>
                <div>
                  <p className="text-lg font-medium text-foreground">Heading 3</p>
                  <p className="text-xs text-foreground-muted mt-1">18px / Medium</p>
                </div>
                <div>
                  <p className="text-base text-foreground">
                    Body text - The quick brown fox jumps over the lazy dog.
                  </p>
                  <p className="text-xs text-foreground-muted mt-1">16px / Regular</p>
                </div>
                <div>
                  <p className="text-sm text-foreground-secondary">
                    Small text - Secondary content and descriptions.
                  </p>
                  <p className="text-xs text-foreground-muted mt-1">14px / Regular</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Tiny text - Labels and metadata</p>
                  <p className="text-xs text-foreground-muted mt-1">12px / Regular</p>
                </div>
              </div>
            </DemoSubsection>

            <DemoSubsection title="Border Radius">
              <div className="flex gap-4 items-end">
                <div className="space-y-2">
                  <div className="h-16 w-16 bg-accent rounded-[var(--radius-sm)]" />
                  <p className="text-xs text-foreground-muted">Small (6px)</p>
                </div>
                <div className="space-y-2">
                  <div className="h-16 w-16 bg-accent rounded-[var(--radius-md)]" />
                  <p className="text-xs text-foreground-muted">Medium (12px)</p>
                </div>
                <div className="space-y-2">
                  <div className="h-16 w-16 bg-accent rounded-[var(--radius-lg)]" />
                  <p className="text-xs text-foreground-muted">Large (16px)</p>
                </div>
                <div className="space-y-2">
                  <div className="h-16 w-16 bg-accent rounded-[var(--radius-full)]" />
                  <p className="text-xs text-foreground-muted">Full</p>
                </div>
              </div>
            </DemoSubsection>
          </DemoSection>

          {/* Section 2: App Components */}
          <DemoSection
            title="App Components"
            description="Solid components for Projects and Watchtower pages"
          >
            <DemoSubsection title="Buttons">
              <div className="flex flex-wrap gap-4 items-center">
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
              </div>
              <div className="flex flex-wrap gap-4 items-center mt-4">
                <Button size="sm">Small</Button>
                <Button size="md">Medium</Button>
                <Button size="lg">Large</Button>
                <Button size="icon">
                  <Activity className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-4 items-center mt-4">
                <Button disabled>Disabled</Button>
              </div>
            </DemoSubsection>

            <DemoSubsection title="Form Controls">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
                <Input label="Title" placeholder="Enter text..." />
                <Input label="With Error" placeholder="Invalid input" error />
                <Input label="Price" startAddon="$" type="number" placeholder="0.00" />
                <Input label="Percentage" endAddon="%" type="number" placeholder="0" />
                <Select label="Agent">
                  <option value="">Choose an option</option>
                  <option value="atlas">Atlas</option>
                  <option value="sage">Sage</option>
                  <option value="max">Max</option>
                  <option value="mason">Mason</option>
                </Select>
                <Input label="Disabled" placeholder="Disabled" disabled />
                <div className="md:col-span-2">
                  <Textarea label="Description" placeholder="Enter a longer message..." />
                </div>
              </div>

              <div className="flex flex-wrap gap-8 mt-6">
                <Checkbox checked={checkboxState} onCheckedChange={setCheckboxState} label="Checkbox" />
                <Toggle pressed={toggleState} onPressedChange={setToggleState} label="Toggle" />
                <Toggle pressed={toggleState2} onPressedChange={setToggleState2} size="sm" label="Small Toggle" />
                <ToggleGroup value={viewMode} onValueChange={setViewMode}>
                  <ToggleGroupItem value="grid">
                    <LayoutDashboard className="h-4 w-4" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="list">
                    <List className="h-4 w-4" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="table">
                    <Table className="h-4 w-4" />
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>

              <div className="mt-8">
                <RadioGroup value={radioValue} onValueChange={setRadioValue}>
                  <RadioGroupItem value="option1" label="Option One" />
                  <RadioGroupItem value="option2" label="Option Two" />
                  <RadioGroupItem value="option3" label="Option Three" />
                </RadioGroup>
              </div>

              <div className="mt-8 max-w-md">
                <p className="text-sm text-foreground-muted mb-3">Option Cards (single select)</p>
                <OptionCardGroup value={optionCardValue} onValueChange={setOptionCardValue}>
                  <OptionCard value="plan1">
                    <div className="font-medium text-foreground">Basic Plan</div>
                    <div className="text-sm text-foreground-secondary">$9/month</div>
                  </OptionCard>
                  <OptionCard value="plan2">
                    <div className="font-medium text-foreground">Pro Plan</div>
                    <div className="text-sm text-foreground-secondary">$29/month</div>
                  </OptionCard>
                </OptionCardGroup>
              </div>

              <div className="mt-8 max-w-md">
                <p className="text-sm text-foreground-muted mb-3">Checkbox Cards (multi-select)</p>
                <div className="flex flex-col gap-3">
                  <CheckboxCard checked={checkboxCard1} onCheckedChange={setCheckboxCard1}>
                    <div className="font-medium text-foreground">Email notifications</div>
                    <div className="text-sm text-foreground-secondary">Receive updates via email</div>
                  </CheckboxCard>
                  <CheckboxCard checked={checkboxCard2} onCheckedChange={setCheckboxCard2}>
                    <div className="font-medium text-foreground">SMS notifications</div>
                    <div className="text-sm text-foreground-secondary">Receive updates via text</div>
                  </CheckboxCard>
                </div>
              </div>

              <div className="max-w-sm mt-8">
                <Slider label="Slider" defaultValue={[56]} max={100} showValue />
              </div>
            </DemoSubsection>

            <DemoSubsection title="Cards">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Default Card</CardTitle>
                    <CardDescription>A basic card component</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-foreground-secondary">
                      Card content goes here. This is a versatile container.
                    </p>
                  </CardContent>
                </Card>
                <Card variant="bordered">
                  <CardHeader>
                    <CardTitle>Bordered Card</CardTitle>
                    <CardDescription>With visible border</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-foreground-secondary">
                      Use for content that needs clear separation.
                    </p>
                  </CardContent>
                  <CardFooter>
                    <Button size="sm">Action</Button>
                  </CardFooter>
                </Card>
                <Card variant="elevated">
                  <CardHeader>
                    <CardTitle>Elevated Card</CardTitle>
                    <CardDescription>With shadow</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-foreground-secondary">
                      Use for emphasized or interactive content.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </DemoSubsection>

            <DemoSubsection title="Badges">
              <div className="flex flex-wrap gap-3">
                <Badge>Default</Badge>
                <Badge variant="success">Success</Badge>
                <Badge variant="warning">Warning</Badge>
                <Badge variant="error">Error</Badge>
                <Badge variant="info">Info</Badge>
                <Badge variant="outline">Outline</Badge>
              </div>
            </DemoSubsection>

            <DemoSubsection title="Avatars">
              <div className="flex flex-wrap gap-4 items-end">
                <Avatar size="sm">
                  <AvatarFallback>SM</AvatarFallback>
                </Avatar>
                <Avatar size="md">
                  <AvatarFallback>MD</AvatarFallback>
                </Avatar>
                <Avatar size="lg">
                  <AvatarFallback>LG</AvatarFallback>
                </Avatar>
              </div>
            </DemoSubsection>

            <DemoSubsection title="Alerts">
              <div className="space-y-4 max-w-2xl">
                <Alert variant="info">This is an informational alert message.</Alert>
                <Alert variant="success">Operation completed successfully!</Alert>
                <Alert variant="warning">Please review before proceeding.</Alert>
                <Alert variant="error" dismissible onDismiss={() => {}}>
                  Something went wrong. This alert can be dismissed.
                </Alert>
              </div>
            </DemoSubsection>

            <DemoSubsection title="Tabs">
              <div className="max-w-2xl">
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList>
                    <TabsTrigger value="general">General</TabsTrigger>
                    <TabsTrigger value="security">Security</TabsTrigger>
                    <TabsTrigger value="notifications">Notifications</TabsTrigger>
                    <TabsTrigger value="advanced" disabled>
                      Advanced
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="general">
                    <Card variant="bordered">
                      <CardContent>
                        <p className="text-foreground-secondary">
                          General settings and preferences for your account.
                        </p>
                      </CardContent>
                    </Card>
                  </TabsContent>
                  <TabsContent value="security">
                    <Card variant="bordered">
                      <CardContent>
                        <p className="text-foreground-secondary">
                          Security settings, passwords, and two-factor authentication.
                        </p>
                      </CardContent>
                    </Card>
                  </TabsContent>
                  <TabsContent value="notifications">
                    <Card variant="bordered">
                      <CardContent>
                        <p className="text-foreground-secondary">
                          Configure how and when you receive notifications.
                        </p>
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </div>
            </DemoSubsection>

            <DemoSubsection title="Tooltips">
              <div className="flex flex-wrap gap-8 items-center">
                <Tooltip content="Shows on the right" side="right">
                  <Button variant="secondary">Hover me (right)</Button>
                </Tooltip>
                <Tooltip content="Shows on the top" side="top">
                  <Button variant="secondary">Hover me (top)</Button>
                </Tooltip>
              </div>
            </DemoSubsection>

            <DemoSubsection title="Dialog">
              <Button onClick={() => setDialogOpen(true)}>Open Dialog</Button>
              <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
                <DialogHeader>
                  <DialogTitle>Example Dialog</DialogTitle>
                  <DialogDescription>This is a modal dialog for confirmations or forms.</DialogDescription>
                </DialogHeader>
                <div className="py-4">
                  <Input placeholder="Enter something..." />
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={() => setDialogOpen(false)}>Confirm</Button>
                </DialogFooter>
              </Dialog>
            </DemoSubsection>
          </DemoSection>

          <DemoSection
            title="Kanban Components"
            description="Components for Projects management"
          >
            <div className="overflow-x-auto -mx-8 px-8">
              <KanbanBoard />
            </div>
          </DemoSection>

          <DemoSection title="Widgets" description="Dashboard widgets (solid variant)">
            <DemoSubsection title="Clock">
              <div className="flex flex-wrap gap-8 items-center">
                <AnalogClock size={200} variant="solid" />
                <AnalogClock size={150} variant="solid" />
                <AnalogClock size={100} variant="solid" />
              </div>
            </DemoSubsection>

            <DemoSubsection title="Uptime">
              <Card variant="bordered" className="max-w-md">
                <CardContent>
                  <Uptime
                    title="Database"
                    status="degraded"
                    uptimePercent={98.5}
                    message="Slow queries detected"
                    data={[
                      100, 100, 100, 100, 95, 100, 100, 100, 100, 100, 100, 100, 100, 100,
                      100, 85, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
                      100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
                      100, 100, 92,
                    ]}
                    labels={["30 days ago", "", "", "", "Today"]}
                  />
                </CardContent>
              </Card>
            </DemoSubsection>

            <DemoSubsection title="Progress">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <Card variant="bordered">
                  <CardContent>
                    <Progress value={522} max={600} trend={32} trendLabel="Over the last 30 days" />
                  </CardContent>
                </Card>
                <Card variant="bordered">
                  <CardContent>
                    <Progress
                      value={45}
                      max={100}
                      variant="accent"
                      trend={-8}
                      trendLabel="From last week"
                    />
                  </CardContent>
                </Card>
              </div>
            </DemoSubsection>

            <DemoSubsection title="Stats">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatWidget
                  variant="solid"
                  label="Total Tokens"
                  value="2.4M"
                  change="+18% from last month"
                  changeType="positive"
                  icon={Database}
                />
                <StatWidget
                  variant="solid"
                  label="Uptime"
                  value="99.9%"
                  change="Last 30 days"
                  changeType="neutral"
                  icon={Activity}
                />
                <StatWidget
                  variant="solid"
                  label="Active Agents"
                  value="5"
                  change="+2 this week"
                  changeType="positive"
                  icon={Users}
                />
                <StatWidget
                  variant="solid"
                  label="API Costs"
                  value="$42"
                  change="-8% from last month"
                  changeType="positive"
                  icon={TrendingUp}
                />
              </div>
            </DemoSubsection>

            <DemoSubsection title="Stock + Goals">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-xl overflow-hidden">
                  <StockWidget
                    ticker="BTC"
                    companyName="Bitcoin"
                    price={104850}
                    change={24580}
                    changePercent={30.62}
                    currency="$"
                    updatedAt="1m ago"
                    chartData={[80270, 80400, 80350, 80600, 80500, 80800, 80700, 81000, 80900, 81200, 81100, 81500]}
                  />
                </div>
                <GoalWidget
                  title="Agents Online"
                  value={5}
                  max={5}
                  size="lg"
                  status="All Active"
                  statusColor="#22c55e"
                  description="Atlas, Mason, Max, Merlin, Sage"
                />
              </div>
            </DemoSubsection>
          </DemoSection>

          <DemoSection
            title="Dashboard Preview"
            description="How the ambient dashboard looks over the background image"
          >
            <div
              className="relative rounded-[var(--radius-lg)] bg-cover bg-center bg-no-repeat overflow-hidden min-h-[600px]"
              style={{ backgroundImage: "url('/bg.jpg')" }}
            >
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ backgroundColor: "var(--dashboard-overlay)" }}
              />

              <Sidebar
                variant="glass"
                className="!absolute !top-4 !left-4 !bottom-4"
                activeItem="dashboard"
                onNavigate={() => {}}
              />
              <UserMenu variant="glass" className="!absolute !top-4 !right-4 z-50" />

              <div className="p-8 relative z-10" style={{ marginLeft: "calc(var(--spacing) * 18)" }}>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <GreetingWidget variant="glass" className="lg:col-span-2" />
                  <div className="flex justify-end">
                    <AnalogClock size={160} variant="glass" />
                  </div>
                  <WeatherWidget variant="glass" />
                  <StatWidget
                    variant="glass"
                    label="Active Sessions"
                    value="24"
                    change="+3 today"
                    changeType="positive"
                    icon={Users}
                  />
                  <StatWidget
                    variant="glass"
                    label="Tasks Completed"
                    value="156"
                    change="This month"
                    changeType="neutral"
                    icon={TrendingUp}
                  />
                  <AgentStatusWidget variant="glass" className="lg:col-span-2" />
                  <GlassCard>
                    <div className="flex items-center gap-3 mb-3">
                      <Clock className="h-5 w-5 text-foreground-secondary" />
                      <h3 className="text-sm font-medium text-foreground">Recent Activity</h3>
                    </div>
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-foreground-secondary">Mason completed PR #42</span>
                        <span className="text-foreground-muted">2m ago</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-foreground-secondary">Sage updated research notes</span>
                        <span className="text-foreground-muted">15m ago</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-foreground-secondary">Atlas scheduled reminder</span>
                        <span className="text-foreground-muted">1h ago</span>
                      </div>
                    </div>
                  </GlassCard>
                </div>
              </div>
            </div>
          </DemoSection>

          <footer className="mt-16 pt-8 border-t border-border text-center">
            <p className="text-sm text-foreground-muted">
              Castle v0.0.1
            </p>
          </footer>
        </div>
      </main>
    </div>
  );
}
